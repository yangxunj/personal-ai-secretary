"""Secretary-managed runtime configuration; provider keys stay in process memory."""
import hashlib
import hmac
import json
import os
import re
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, '/app/backend')
from flask import jsonify, request
from app import app, _acquire_instance_lock, _port_available, _reconcile_orphaned_tasks_on_startup
from models.task import Task
from services.ai_service_manager import clear_ai_service_cache

TOKEN_PATH = Path(os.environ.get('DATABASE_PATH', '/app/backend/instance/database.db')).parent / '.secretary-control-token'
LOCK = threading.RLock()
current_fingerprint = None


def read_token():
    try:
        token = TOKEN_PATH.read_text(encoding='ascii').strip()
        return token if re.fullmatch(r'[a-f0-9]{64}', token) else None
    except (OSError, UnicodeError):
        return None


@app.get('/api/secretary/capabilities')
def secretary_capabilities():
    token = read_token()
    nonce = request.headers.get('X-Secretary-Nonce', '')
    if not token or not re.fullmatch(r'[a-f0-9]{64}', nonce):
        return jsonify({'error': 'unavailable'}), 503
    proof = hmac.new(token.encode('ascii'), nonce.encode('ascii'), hashlib.sha256).hexdigest()
    return jsonify({'version': 1, 'proof': proof})


@app.post('/api/secretary/configure')
def secretary_configure():
    global current_fingerprint
    token = read_token()
    supplied = request.headers.get('X-Secretary-Control', '')
    if not token or not re.fullmatch(r'[a-f0-9]{64}', supplied) or not hmac.compare_digest(token, supplied):
        return jsonify({'error': 'unauthorized'}), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'textBaseUrl', 'textKey', 'textModel', 'imageKey'}:
        return jsonify({'error': 'invalid config'}), 400
    if any(not isinstance(v, str) or not v or len(v) > 4096 or '\n' in v or '\r' in v for v in data.values()):
        return jsonify({'error': 'invalid config'}), 400
    try:
        parsed = urlparse(data['textBaseUrl'])
        valid_url = parsed.scheme in ('http', 'https') and bool(parsed.hostname) and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
    except ValueError:
        valid_url = False
    if not valid_url:
        return jsonify({'error': 'invalid config'}), 400
    # Keep the comparison secret-dependent and never log or return provider keys.
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    fingerprint = hmac.new(token.encode('ascii'), canonical, hashlib.sha256).digest()
    values = dict(
            AI_PROVIDER_FORMAT='openai',
            TEXT_MODEL_SOURCE='openai', TEXT_API_BASE=data['textBaseUrl'], TEXT_API_KEY=data['textKey'], TEXT_MODEL=data['textModel'],
            IMAGE_CAPTION_MODEL_SOURCE='openai', IMAGE_CAPTION_API_BASE=data['textBaseUrl'],
            IMAGE_CAPTION_API_KEY=data['textKey'], IMAGE_CAPTION_MODEL=data['textModel'],
            IMAGE_MODEL_SOURCE='openai', IMAGE_API_BASE='https://openrouter.ai/api/v1',
            IMAGE_API_KEY=data['imageKey'], IMAGE_MODEL='meta/muse-image',
    )
    with LOCK:
        if current_fingerprint and hmac.compare_digest(current_fingerprint, fingerprint) and all(app.config.get(k) == v for k, v in values.items()):
            return jsonify({'ok': True})
        if Task.query.filter(Task.status.in_(['PENDING', 'PROCESSING', 'RUNNING'])).first():
            return jsonify({'error': 'busy'}), 409
        app.config.update(values)
        clear_ai_service_cache()
        current_fingerprint = fingerprint
    return jsonify({'ok': True})


if __name__ == '__main__':
    if _acquire_instance_lock(app) and _port_available(5000):
        _reconcile_orphaned_tasks_on_startup()
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
