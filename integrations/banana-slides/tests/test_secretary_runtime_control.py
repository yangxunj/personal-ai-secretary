"""Isolated integration tests for the managed engine configuration boundary."""
import hashlib
import hmac
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

tmp = tempfile.TemporaryDirectory(prefix='secretary-ppt-control-test-')
root = Path(tmp.name)
os.environ['DATABASE_PATH'] = str(root / 'database.db')
os.environ['DATABASE_URL'] = 'sqlite:///' + str(root / 'database.db')
os.environ['UPLOAD_FOLDER'] = str(root / 'uploads')
os.environ['IN_DOCKER'] = '1'
sys.path.insert(0, '/app')
import secretary_runtime_control as runtime
from models import db
from models.project import Project
from models.task import Task

TOKEN = 'a' * 64
BODY = {'textBaseUrl': 'https://example.invalid/v1', 'textKey': 'test-text-not-real', 'textModel': 'deepseek-chat', 'imageKey': 'test-image-not-real'}


class RuntimeControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        runtime.TOKEN_PATH.write_text(TOKEN, encoding='ascii')
        with runtime.app.app_context():
            db.create_all()

    def setUp(self):
        self.client = runtime.app.test_client()
        with runtime.app.app_context():
            Task.query.delete()
            Project.query.delete()
            db.session.commit()
        runtime.current_fingerprint = None

    def test_challenge_and_unauthorized_write(self):
        nonce = 'b' * 64
        response = self.client.get('/api/secretary/capabilities', headers={'X-Secretary-Nonce': nonce})
        expected = hmac.new(TOKEN.encode(), nonce.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(response.json, {'version': 1, 'proof': expected})
        self.assertEqual(self.client.get('/api/secretary/capabilities').status_code, 503)
        response = self.client.post('/api/secretary/configure', json=BODY)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post('/api/secretary/configure', json=BODY, headers={'X-Secretary-Control': 'invalid'}).status_code, 403)
        self.assertNotIn(BODY['imageKey'], response.get_data(as_text=True))

    def test_config_is_memory_only_and_changes_wait_for_running_task(self):
        headers = {'X-Secretary-Control': TOKEN}
        response = self.client.post('/api/secretary/configure', json=BODY, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(runtime.app.config['TEXT_MODEL'], 'deepseek-chat')
        self.assertEqual(runtime.app.config['IMAGE_MODEL'], 'meta/muse-image')
        self.assertNotIn(BODY['imageKey'], response.get_data(as_text=True))
        with runtime.app.app_context():
            project = Project(id=str(uuid.uuid4()), creation_type='idea', status='DRAFT')
            db.session.add(project)
            db.session.add(Task(id=str(uuid.uuid4()), project_id=project.id, task_type='GENERATE_IMAGES', status='PENDING'))
            db.session.commit()
        self.assertEqual(self.client.post('/api/secretary/configure', json=dict(reversed(list(BODY.items()))), headers=headers).status_code, 200)
        changed = dict(BODY, textModel='deepseek-new')
        self.assertEqual(self.client.post('/api/secretary/configure', json=changed, headers=headers).status_code, 409)
        self.assertEqual(runtime.app.config['TEXT_MODEL'], 'deepseek-chat')
        with runtime.app.app_context():
            Task.query.update({'status': 'FAILED'})
            db.session.commit()
        self.assertEqual(self.client.post('/api/secretary/configure', json=changed, headers=headers).status_code, 200)
        self.assertEqual(runtime.app.config['TEXT_MODEL'], 'deepseek-new')
        data = (root / 'database.db').read_bytes()
        self.assertNotIn(BODY['textKey'].encode(), data)
        self.assertNotIn(BODY['imageKey'].encode(), data)

    def test_invalid_url_is_rejected(self):
        headers = {'X-Secretary-Control': TOKEN}
        self.assertEqual(self.client.post('/api/secretary/configure', json=dict(BODY, textBaseUrl='https://user:password@example.invalid'), headers=headers).status_code, 400)
        self.assertEqual(self.client.post('/api/secretary/configure', json=dict(BODY, textBaseUrl='https://['), headers=headers).status_code, 400)


if __name__ == '__main__':
    unittest.main()
