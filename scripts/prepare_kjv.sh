#!/bin/sh
set -eu

input=${1:-corpus/raw/bible-kjv-gutenberg-30.txt}
output=${2:-corpus/bible-kjv.txt}
temporary="${output}.tmp"

awk '
{
    sub(/\r$/, "", $0)
    gsub(/â€”/, "--", $0)
    if (copying && /^\*\*\* END OF THE PROJECT GUTENBERG EBOOK /) {
        complete = 1
        exit
    }
    if ($0 == "Book 01 Genesis") {
        genesis_count++
        if (genesis_count == 2) copying = 1
    }
    if (copying) {
        sub(/^[0-9][0-9]:[0-9][0-9][0-9]:[0-9][0-9][0-9] /, "", $0)
        print
    }
}
END {
    if (!copying || !complete) exit 2
}
' "$input" > "$temporary"

mv "$temporary" "$output"
