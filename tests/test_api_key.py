"""API key paste normalization (portal clipboard junk)."""
from app.config import normalize_api_key, set_session_api_key, clear_session_api_key


def test_normalize_strips_whitespace_and_quotes():
    raw = '  "RGAPI-abcd-1234" \n'
    assert normalize_api_key(raw) == "RGAPI-abcd-1234"


def test_normalize_extracts_key_from_labeled_paste():
    raw = "Development API Key:\nRGAPI-aaaa-bbbb-cccc-ddddeeeeffff\n"
    assert normalize_api_key(raw) == "RGAPI-aaaa-bbbb-cccc-ddddeeeeffff"


def test_normalize_removes_mid_key_linebreaks():
    raw = "RGAPI-aaaa-\nbbbb-cccc"
    assert normalize_api_key(raw) == "RGAPI-aaaa-bbbb-cccc"


def test_set_session_rejects_placeholder():
    clear_session_api_key()
    try:
        set_session_api_key("RGAPI-your-key-here")
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "RGAPI-" in str(e)
