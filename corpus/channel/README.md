# Channel and reply corpus

`channel_corpus` converts dramatic text, verse, or a consented chat export into
reply-targeted records. A record is not a raw transcript dump. It contains:

1. a channel style and compact, lossy memory or “vibe”;
2. up to three recent messages with locally anonymized speaker roles;
3. an explicit reply-to role; and
4. either the reply or the next lossy memory ZERO is trained to produce.

The binary format uses values already present in the 128-character vocabulary:

| Value | Meaning |
| ---: | --- |
| `1` | channel record begins |
| `2` | message begins |
| `3` | next byte is the replied-to role |
| `4` | message ends |
| `5` | record ends |
| `6` | target reply content begins |
| `7` | channel summary begins |

These control values previously had embedding rows but never appeared in the
literary corpus. Reusing them adds no model parameters. During channel
training, cross-entropy is masked so only bytes after target marker `6` through
message-end marker `4` contribute directly to loss. The old memory and prior
messages still influence the target through causal attention.

Non-overlapping two-turn blocks also create memory-transition examples:

```text
old lossy memory + recent messages -> new lossy memory
```

At inference time each human/model pair updates the generated memory and is
then discarded from working context. The next pair begins from that memory.
This gives the channel a bounded recurrent state rather than an ever-growing
transcript. It adds no parameters; reply and memory updates are two learned
uses of the same model.

## Build the literary channel data

```sh
make channel-data
```

Shakespeare and Crowley speaker turns become multi-member channels. Blake
stanzas become alternating poetic turns. Each author-specific record is also
emitted with the generic `D` style, allowing the browser’s mixed voice to draw
from every source.

## Import a human chat export

For chat data, first export only channels whose participants have permitted the
intended training use. Remove secrets, links, attachments, private identifiers,
and deleted material. Then prepare UTF-8 TSV in chronological order:

```text
channel<TAB>message-id<TAB>reply-id<TAB>speaker<TAB>text<TAB>optional vibe<TAB>optional rolling-memory
```

The channel vibe is normally supplied only on the first row. A rolling-memory
column may contain a short summary of the channel as of that row; when it is
absent, the converter derives a deliberately lossy summary from recent turns.
Speaker names are remapped to local roles inside every example; they are not
written to the training record. Convert it with:

```sh
./channel_corpus \
  --chat H consented-chat.tsv \
  --out corpus/channel/consented-chat.tok
```

An explicit reply ID takes precedence over chronological adjacency. If the
replied-to message is older than the normal recent window, it is pulled into
the context. Entire channels—not random messages—should be held out when
constructing a final evaluation set.

For a targeted memory-consolidation pass, add `--memory-only` to emit only the
`old memory + pair -> new memory` records. Mixing that file with the original
literary streams lets the model refine compression while continuing to rehearse
its language base.
