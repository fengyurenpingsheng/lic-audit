# Submissions

`accepted/` holds one JSON file per accepted method. The site and the board are built from these files and the frozen
entries in `data/board.json`.

A submission file is made on the site (Evaluate a method, step 4). Its fields:

```json
{"schema_version": 1,
 "method": {"key": "my-codec2027", "name": "My codec", "year": 2027, "venue": "CVPR", "family": "E|T|O|R|unknown",
            "paper_url": "https://...", "contact": "optional"},
 "curves": [{"dataset": "kodak|tecnick|clic_pv", "dataset_label": "as written in the paper", "metric": "psnr_rgb",
             "psnr_definition": "rgb_8bit|ycbcr_y|unknown",
             "rate_accounting": "actual_bitstream|estimated_likelihood|unknown",
             "aggregation": "mean_per_image|psnr_of_mean_mse|pixel_weighted|unknown",
             "points": [{"bpp": 0.143, "psnr_db": 30.09}, "..."],
             "provenance": {"repository": "owner/name", "commit": "<sha>", "path": "results/kodak.json"}}]}
```

With `schema_version` 2, each point carries an `op_id` and the curve carries `per_image` records
(`image_id`, `op_id`, `reported_bpp` or `total_bitstream_bytes` with `width` and `height`, `psnr_rgb_db`).

Rules: one curve per test set; the curve must span the fixed window; rates estimated from likelihoods and averaging
rules other than the mean of per-image values are scored for diagnosis and are not ranked; luma PSNR and other test-set
splits are rejected; the method key must be new.

`examples/example_method.json` is a synthetic example.
