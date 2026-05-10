import argparse
from pathlib import Path

import kagglehub

DATASET = "pranavchandane/scut-fbp5500-v2-facial-beauty-scores"


def main() -> None:
    parser = argparse.ArgumentParser(description="Download SCUT-FBP5500 v2 via kagglehub")
    parser.add_argument("--dataset", default=DATASET, help="Kaggle dataset slug")
    parser.add_argument("--link", action="store_true", help="Create ./ml/data symlink to downloaded version")
    args = parser.parse_args()

    path = Path(kagglehub.dataset_download(args.dataset)).resolve()
    print(f"Downloaded dataset path: {path}")

    if args.link:
        link = Path(__file__).resolve().parent / "data"
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(path, target_is_directory=True)
        print(f"Symlink created: {link} -> {path}")


if __name__ == "__main__":
    main()
