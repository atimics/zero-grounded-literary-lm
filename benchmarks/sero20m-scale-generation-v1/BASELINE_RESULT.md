# Sero 6M matched scale-generation baseline

This diagnostic freezes the 6M baseline on the same curriculum test documents and prompts that will be used for the 20M model.

## Held-out context test

Each row scores the same 64-token held-out continuations using different amounts
of real preceding test text. It also greedily generates 64 tokens from each prompt.

| Prompt tokens | Reference BPB | Change vs 1 token | Top-1 token accuracy | Greedy distinct-4 | Severe loops |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.6911 | +0.0000 | 38.0% | 42.9% | 91.7% |
| 8 | 1.6299 | -0.0612 | 38.7% | 34.6% | 91.7% |
| 32 | 1.5634 | -0.1277 | 41.0% | 40.2% | 83.3% |
| 128 | 1.4313 | -0.2598 | 43.8% | 39.1% | 83.3% |

The 128-token prompt reduced loss in 11 of 12 paired cases. Its mean change was -0.2598 BPB (normal-approximation 95% interval -0.3769 to -0.1426). This shows that the model uses longer context for prediction, even though greedy continuations still loop.

## Free-generation decoding test

| Decoder | Samples | Token distinct-4 | Word distinct-4 | Severe loops | Valid UTF-8 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| greedy | 18 | 20.7% | 25.0% | 94.4% | 100.0% |
| sample-t08-p90 | 36 | 77.5% | 83.9% | 52.8% | 100.0% |
| sample-t08-p90-r11 | 36 | 95.7% | 97.6% | 5.6% | 100.0% |

The repetition penalty is an inference aid, not evidence that the weights learned
better facts or reasoning. The representative outputs remain semantically confused
even when their n-grams are diverse.

### Results by prompt family

| Family | Decoder | Token distinct-4 | Severe loops |
| :--- | :--- | ---: | ---: |
| assistant | greedy | 24.8% | 100.0% |
| assistant | sample-t08-p90 | 84.8% | 50.0% |
| assistant | sample-t08-p90-r11 | 81.6% | 50.0% |
| code | greedy | 12.8% | 100.0% |
| code | sample-t08-p90 | 78.0% | 50.0% |
| code | sample-t08-p90-r11 | 84.8% | 0.0% |
| creative | greedy | 14.0% | 100.0% |
| creative | sample-t08-p90 | 47.6% | 75.0% |
| creative | sample-t08-p90-r11 | 97.6% | 25.0% |
| dialogue | greedy | 15.2% | 100.0% |
| dialogue | sample-t08-p90 | 95.6% | 0.0% |
| dialogue | sample-t08-p90-r11 | 99.6% | 0.0% |
| knowledge | greedy | 15.5% | 100.0% |
| knowledge | sample-t08-p90 | 85.0% | 30.0% |
| knowledge | sample-t08-p90-r11 | 98.2% | 0.0% |
| long-form | greedy | 15.6% | 100.0% |
| long-form | sample-t08-p90 | 90.6% | 25.0% |
| long-form | sample-t08-p90-r11 | 96.4% | 0.0% |
| one-token-control | greedy | 26.1% | 100.0% |
| one-token-control | sample-t08-p90 | 75.3% | 83.3% |
| one-token-control | sample-t08-p90-r11 | 96.7% | 0.0% |
| reasoning | greedy | 47.4% | 50.0% |
| reasoning | sample-t08-p90 | 62.1% | 100.0% |
| reasoning | sample-t08-p90-r11 | 93.7% | 0.0% |
| user-challenge | greedy | 10.4% | 100.0% |
| user-challenge | sample-t08-p90 | 84.8% | 50.0% |
| user-challenge | sample-t08-p90-r11 | 99.2% | 0.0% |

## Representative seed-0 outputs

### control-in — greedy

Prompt: `In`

> dia's first national team ↵  ↵ India's first national team, has a national team, which is in India. It is a national team, which is in India's first national team, has a national team, which is in India's first national team, has a national team, which is in India's first national team, has a national team, which is in India's first 

### control-in — sample-t08-p90

Prompt: `In`

> stead of Matthews' During the Bazzini Brazilian Development Minister Mahattanistan/Brazilian Development and Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcelona/Barcel

### control-in — sample-t08-p90-r11

Prompt: `In`

> dian Olympics ↵  ↵ Indian Olympic (IAL) is a 2017 movie drama movie, directed by Georgia. There are many major films, such as the Nazi Air Force and the Division of Sciences. ↵ The movie was first made from the Divisionary and DC Champion, winning the sixth time as the 2nd starring in the United States. ↵ It has been critical of the Divis

### history — greedy

Prompt: `The history of astronomy began with`

>  the British Empire ↵  ↵ The history of astronomy was the first time that the history of astronomy was the first time that the history was the first time that the history was the first time that the history was the first time that the history was the first time that the history was the first time that the history was the first time that the history was the f…

### history — sample-t08-p90

Prompt: `The history of astronomy began with`

>  several major American bands in the United States, the "Mike Planet Band" and "The Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Wings of the Win…

### history — sample-t08-p90-r11

Prompt: `The history of astronomy began with`

>  a partnership with a great dealer that could be used for the game and creation. It helps us will only do a very good shop into a minute. ↵ Chapter 12. Next of the final Branching the title of characters and water politics. ↵ Many people have a special conflict, all over the past two past days for them and the locations that are not considered. They are gett…

### question-answer — greedy

Prompt: `Question: ↵ Why does ice float on water? ↵  ↵ Reasoning: ↵ `

> The water is 2 * 2 = 12 floats. ↵ The water is 12 * 2 = 12 floats. ↵ The water is 12 * 2 = 12 floats. ↵ The water is 12 * 2 = 12 floats. ↵ The water is 12 * 2 = 12 floats. ↵ The water is 12 * 2 = 12 floats. ↵ The wat

### question-answer — sample-t08-p90

Prompt: `Question: ↵ Why does ice float on water? ↵  ↵ Reasoning: ↵ `

> Buys a small number of floats is 1/2 = 2 floats. ↵ He also went to the ice floats every water is 2 x 2 = 3 floats. ↵ He used to get to the ice floats every water is 3 + 3 = 14 floats. ↵ There are 14 floats in the ice floats every water is 3 + 14 = 24 floats. ↵ Therefore, he used to get 

### question-answer — sample-t08-p90-r11

Prompt: `Question: ↵ Why does ice float on water? ↵  ↵ Reasoning: ↵ `

> If 1 water, the wash for the goal is 2*1=5 fishing the washes on water. ↵ So, the wash for the wash for is 5+5=30 fishing the washes on Water. ↵  ↵ Final answer: 30

### committee — greedy

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , "The committee is going to do so far." The committee is also a "" (""), which is "the committee is going to do so far." The committee is also a "" (""), which is "the committee is going to do so far." The committee is also a "" (""), which is "the committee is going to do so far." The committee is also a "" (""), which is "the comm

### committee — sample-t08-p90

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , despite the Government went to discuss regarding European investment in the release of the Senate, which had been to complete the incident in that he will not take up the regime due to the issue. ↵ Tuesday's regime was created to the regime and cooperation in the previous months after the investigations attempted to host the discussion on its independent.…

### committee — sample-t08-p90-r11

Prompt: `The committee met on Tuesday to discuss the proposed changes. After several hours of debate, the members agreed that`

> , according to the "", stating that the proposed agreement was completely finalised in its diplomatic opportunities, and there is no negative opportunity to protect the issue of a committee on Tuesday. ↵ "The committee would be delayed," the Commissioner of Intelligence Minister said. "There was not the promise of a commitment to make money for the subject o…

## Scope

The context test uses disjoint held-out test documents. Free prompts include
Wikipedia-like prose, narrative/dialogue, question-answer, assistant, and code
formats. Sampling can expose usable probability mass, but it cannot repair missing
knowledge or long-range structure in the weights.
