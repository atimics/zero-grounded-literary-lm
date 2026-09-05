import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = name => readFileSync(name, "utf8");
function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, `one replacement site: ${before}`);
  return source.replace(before, after);
}
const output = (name, source) => writeFileSync(`build/${name}`, source);
mkdirSync("build", { recursive: true });

let base = read("reasoner55.c");
base = replace(base, "} r55_sha256;", "} r55_ref_sha256;");
const begin = base.indexOf("static uint32_t r55_rotr(");
const end = base.indexOf("static void r55_digest(");
assert.ok(begin >= 0 && end > begin);
base = base.slice(0, begin) + base.slice(begin, end).replaceAll("r55_sha256", "r55_ref_sha256") +
  '#include "reasoner55_fast_hash.h"\n#include "reasoner55_fast_sort.h"\n\n' + base.slice(end);
base = replace(base, "static int r55_search(const r55_public_episode *public_episode,",
  "R55FAST_DEFINE_SORT(r55fast_sort_candidates, r55_candidate, r55_candidate_compare)\n\n" +
  "static int r55_search(const r55_public_episode *public_episode,");
base = replace(base, "qsort(ranked, R55_CANDIDATES, sizeof(ranked[0]), r55_candidate_compare);",
  "r55fast_sort_candidates(ranked, R55_CANDIDATES);");
output("reasoner55_fast_base.h", base);

const diagnostics = replace(read("reasoner55_diagnostics.c"), '#include "reasoner55.c"',
  '#include "reasoner55_fast_base.h"');
output("reasoner55_fast_diagnostics.h", diagnostics);
let guide = replace(read("reasoner55_semantic_guide.c"), '#include "reasoner55_diagnostics.c"',
  '#include "reasoner55_fast_diagnostics.h"');
guide = replace(guide, "static void r55sg_feature_digest(",
  "R55FAST_DEFINE_SORT(r55fast_sort_groups, r55sg_group, r55sg_group_compare)\n\nstatic void r55sg_feature_digest(");
guide = replace(guide, "qsort(u->groups, u->count, sizeof(u->groups[0]), r55sg_group_compare);",
  "r55fast_sort_groups(u->groups, u->count);");
guide = replace(guide, "int main(int argc, char **argv)", "int r55fast_guide_main(int argc, char **argv)");
output("reasoner55_fast_guide.h", guide);
let fixed = replace(read("reasoner55_fixed_transfer.c"), '#include "build/reasoner55_semantic_guide_embed.h"',
  '#include "reasoner55_fast_guide.h"');
fixed = replace(fixed, "int main(int argc, char **argv)", "int r55fast_fixed_main(int argc, char **argv)");
output("reasoner55_fast_fixed.h", fixed);
