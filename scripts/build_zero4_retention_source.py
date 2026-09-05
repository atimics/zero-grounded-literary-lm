"""Build the diagnostic trainer from an exact frozen source and checked patch."""

import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = "5f4c47e0fedcc0f96d5eafcd8f45f6bfc4808a1d1af7434cb188693449ff53e3"
RESULT_SHA256 = "944f28fdbc04185cbac905ccc78293fe3d0d8b259bbdc9d508d28123e543b99f"


def build_source(source, patch, output):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("frozen trainer source differs")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="retention-source-", dir=output.parent) as name:
        temporary = Path(name) / "trainer.c"
        subprocess.run(["patch", "-s", "-o", str(temporary), str(source), str(patch)], check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != RESULT_SHA256:
            raise ValueError("instrumented trainer source differs")
        temporary.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build_source(ROOT / "literary_lm.c", ROOT / "scripts/zero4_retention.patch", args.out.resolve())
