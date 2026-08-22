# Sero 1 expanded generation evaluation

This is a post-training diagnostic, not a new promotion gate. It evaluates the exact
three promoted Sero 1 checkpoints.

## Held-out context test

Each row scores the same 64-token held-out continuations using different amounts
of real preceding test text. It also greedily generates 64 tokens from each prompt.

| Prompt tokens | Reference BPB | Change vs 1 token | Top-1 token accuracy | Greedy distinct-4 | Severe loops |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.7809 | +0.0000 | 30.2% | 37.0% | 86.1% |
| 8 | 1.7614 | -0.0194 | 30.8% | 36.7% | 83.3% |
| 32 | 1.7281 | -0.0528 | 31.8% | 35.6% | 88.9% |
| 128 | 1.6674 | -0.1135 | 33.2% | 30.9% | 91.7% |

The 128-token prompt reduced loss in 31 of 36 paired cases. Its mean change was -0.1135 BPB (normal-approximation 95% interval -0.1550 to -0.0719). This shows that the model uses longer context for prediction, even though greedy continuations still loop.

## Free-generation decoding test

| Decoder | Samples | Token distinct-4 | Word distinct-4 | Severe loops | Valid UTF-8 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| greedy | 48 | 13.3% | 16.6% | 100.0% | 97.9% |
| sample-t08-p90 | 144 | 84.9% | 92.3% | 36.1% | 97.9% |
| sample-t08-p90-r11 | 144 | 96.4% | 98.2% | 6.2% | 98.6% |

The repetition penalty is an inference aid, not evidence that the weights learned
better facts or reasoning. The representative outputs remain semantically confused
even when their n-grams are diverse.

### Results by prompt family

| Family | Decoder | Token distinct-4 | Severe loops |
| :--- | :--- | ---: | ---: |
| in-domain | greedy | 15.6% | 100.0% |
| in-domain | sample-t08-p90 | 89.0% | 27.8% |
| in-domain | sample-t08-p90-r11 | 97.7% | 3.7% |
| long-form | greedy | 10.5% | 100.0% |
| long-form | sample-t08-p90 | 91.4% | 16.7% |
| long-form | sample-t08-p90-r11 | 89.2% | 22.2% |
| one-token-control | greedy | 14.1% | 100.0% |
| one-token-control | sample-t08-p90 | 76.4% | 66.7% |
| one-token-control | sample-t08-p90-r11 | 97.2% | 3.7% |
| out-of-domain | greedy | 11.3% | 100.0% |
| out-of-domain | sample-t08-p90 | 82.6% | 35.6% |
| out-of-domain | sample-t08-p90-r11 | 97.2% | 4.4% |

## Representative seed-0 outputs

### control-in — greedy

Prompt: `In`

> troduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introduction. ↵ Introducti…

### control-in — sample-t08-p90

Prompt: `In`

> formation of CSE is known as CSE. It is a free size. It is named after the single "Blue Mar" (5th December 1999). It is named after the name of the Blue Mar" (2002), and its original size and is named after the name "Blue Mar" (2006). ↵ The Blue Mar" was named after the name "Blue Mar" (2006). ↵ When the name of CSE's name

### control-in — sample-t08-p90-r11

Prompt: `In`

> troduction of 1967, NASA's international police reformed the Filipino from the Indonesian Union (FBI) that situation is "a potentially progress" in the world as "the Labor Council of Interest" and the Industrial Association. The future was "15-14" site to be an intro of the International Association's Purency Seas and Michig

### history — greedy

Prompt: `The history of astronomy began with`

>  the British Airport of Airport and the British Airport of Airport and the British Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of Airport and Airport of A

### history — sample-t08-p90

Prompt: `The history of astronomy began with`

>  the British national elections (the British government has not lived in Peru). In 1797 the British Libert was the Serbian to discuss military membership with the Congress. ↵ During the British stations in British Government and the situation, an American government announced its national policy. In the same order to understand the British government would r…

### history — sample-t08-p90-r11

Prompt: `The history of astronomy began with`

>  the Khanyo House of Pennsylvania () in 1978. ↵ In 1976, Hurricane II, the history died in 1979, in 1980. ↵ The history of the history died on 1 May 1979, at the age of 82. It was diagnosed by the 1979 Electrical History of the 2014 Republic Committee in 1975. The history

### question-answer — greedy

Prompt: `Question: Why does ice float on water? ↵ Answer:`

>  One Street is an example of this float and the float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this float is an example of this

### question-answer — sample-t08-p90

Prompt: `Question: Why does ice float on water? ↵ Answer:`

>  Officiency connections: Why do you think you are most remembered that you are in your network? ↵ Answer: You can get that you are now very student? ↵ Answer narrative directors are part of them on the Internet autonomous work. We need to work on their actual examples that are probably done in more than 250 people. ↵ Answer narrative was a company on how to…

### question-answer — sample-t08-p90-r11

Prompt: `Question: Why does ice float on water? ↵ Answer:`

> : So I don't actually want a place as the greatest thing. I don't think? ↵ Answer:: I think the same reason is getting around the world so well. It's quite a fake has a minimum of people because it was more popular to their scientists in the world. ↵ DS: No, I think it's a degree to many big jobs and some points. I don't say anything or narrating for what we…

### committee — greedy

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , "The committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the committee is that the c…

### committee — sample-t08-p90

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , Mr. Folk had been published in the days after he was finished. Social after Nazi Gagar, an Australian plan to claim that the statement was "regarded as a special free center" and "literature" rules that the contribution of Australian Australia had re-per-described many preferences at a time while Mr. Folk had preferred to the Eastern A

### committee — sample-t08-p90-r11

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , “G.P.A. is likely to do anything like that, so he is anticipated by what you are doing it to meet the world” and when you do all the states of Wikinews who has got the age of companies. Throughout his books allowed them to be the future of the manner also wants to connect with the law as he performed. To make sure that G.P.A. effectivity in any of these pr…

## Scope

The context test uses disjoint held-out test documents. Free prompts include
Wikipedia-like prose, narrative/dialogue, question-answer, assistant, and code
formats. Sampling can expose usable probability mass, but it cannot repair missing
knowledge or long-range structure in the weights.
