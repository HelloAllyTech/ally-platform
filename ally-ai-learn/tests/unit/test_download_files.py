import app.download_files as download_files


def test_download_required_files_uses_default_threshold(monkeypatch):
    calls = {}

    class DummyVAD:
        @staticmethod
        def load(activation_threshold):
            calls["activation_threshold"] = activation_threshold
            return "ok"

    monkeypatch.setattr(download_files.silero, "VAD", DummyVAD)

    download_files.download_required_files()

    assert calls["activation_threshold"] == 0.7
