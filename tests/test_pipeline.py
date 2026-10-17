import unittest
from types import SimpleNamespace
from unittest.mock import patch

from workspace import _result, fetch_transcripts, video_id


class TranscriptPipelineTests(unittest.TestCase):
    def test_video_id_supports_shorts_and_watch_urls(self):
        self.assertEqual(video_id("https://youtube.com/shorts/abc123?si=x"), "abc123")
        self.assertEqual(video_id("https://youtu.be/abc123"), "abc123")
        self.assertEqual(video_id("https://www.youtube.com/watch?v=abc123"), "abc123")
        self.assertIsNone(video_id("https://example.com/video/abc123"))

    def test_error_result_is_preserved(self):
        record = _result(
            "https://youtube.com/shorts/abc123",
            {"success": False, "error_type": "NoTranscriptFound"},
        )
        self.assertFalse(record["success"])
        self.assertEqual(record["error"], "NoTranscriptFound")
        self.assertIsNone(record["transcript"])

    def test_records_from_run_accepts_sdk_model_attributes(self):
        from workspace import records_from_run

        dataset = type("Dataset", (), {"iterate_items": lambda self: iter([])})()
        client = type("Client", (), {"dataset": lambda self, dataset_id: dataset})()
        run = SimpleNamespace(status="SUCCEEDED", default_dataset_id="dataset-id")
        self.assertFalse(records_from_run(
            client, run, ["https://youtube.com/shorts/abc123"]
        )[0]["success"])

    def test_fetch_maps_dataset_item_to_original_url(self):
        url = "https://youtube.com/shorts/abc123?si=tracking"
        dataset = type("Dataset", (), {"iterate_items": lambda self: iter([
            {
                "video_id": "abc123",
                "url": "https://www.youtube.com/watch?v=abc123",
                "success": True,
                "non_timestamped": "Example transcript",
                "timestamped": [{"text": "Example transcript", "start": 0, "duration": 2}],
                "language_code": "en",
            }
        ])})()
        actor = type("Actor", (), {"call": lambda self, **kwargs: {
            "status": "SUCCEEDED",
            "defaultDatasetId": "dataset-id",
        }})()
        client = type("Client", (), {
            "actor": lambda self, actor_id: actor,
            "dataset": lambda self, dataset_id: dataset,
        })()

        with patch("workspace.ApifyClient", return_value=client):
            records = fetch_transcripts([url], "token-is-not-logged")

        self.assertEqual(records[0]["url"], url)
        self.assertTrue(records[0]["success"])
        self.assertEqual(records[0]["transcript"], "Example transcript")


if __name__ == "__main__":
    unittest.main()
