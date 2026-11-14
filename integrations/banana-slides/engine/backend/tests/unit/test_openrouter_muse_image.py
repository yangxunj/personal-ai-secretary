"""OpenRouter Muse uses its dedicated image endpoint for slide edits."""

import base64
from io import BytesIO
from unittest.mock import MagicMock, patch
import unittest

from PIL import Image

from services.ai_providers.image.openai_provider import OpenAIImageProvider


def make_provider():
    with patch('services.ai_providers.image.openai_provider.OpenAI'):
        return OpenAIImageProvider('test-key', 'https://openrouter.ai/api/v1', 'meta/muse-image')


def png_data():
    buf = BytesIO()
    Image.new('RGB', (12, 8), 'green').save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def check_muse_sends_current_slide_first_and_returns_new_image():
    provider = make_provider()
    response = MagicMock(status_code=200)
    response.json.return_value = {'data': [{'b64_json': png_data()}]}
    refs = [Image.new('RGB', (20, 10), 'red'), Image.new('RGB', (10, 10), 'blue')]
    with patch('services.ai_providers.image.openai_provider.requests.post', return_value=response) as post:
        image = provider.generate_image('change the title', refs, '16:9')
    assert image.size == (12, 8)
    assert post.call_args.args[0] == 'https://openrouter.ai/api/v1/images'
    body = post.call_args.kwargs['json']
    assert body['prompt'] == 'change the title'
    assert body['aspect_ratio'] == '16:9'
    for reference, color in zip(body['input_references'], ('red', 'blue')):
        raw = reference['image_url']['url'].split(',', 1)[1]
        actual = Image.open(BytesIO(base64.b64decode(raw))).convert('RGB').getpixel((0, 0))
        assert actual[0 if color == 'red' else 2] > 240


def check_muse_reports_failure_without_returning_or_logging_response_body():
    provider = make_provider()
    response = MagicMock(status_code=401)
    with patch('services.ai_providers.image.openai_provider.requests.post', return_value=response):
        with unittest.TestCase().assertRaisesRegex(Exception, 'HTTP 401'):
            provider.generate_image('edit', [Image.new('RGB', (8, 8))])
    response.json.assert_not_called()


class MuseImageTests(unittest.TestCase):
    def test_reference_order(self):
        check_muse_sends_current_slide_first_and_returns_new_image()

    def test_http_failure(self):
        check_muse_reports_failure_without_returning_or_logging_response_body()
