import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
let source = readFileSync('reasoner55_matched_transfer.c', 'utf8');
const signature = 'int main(int argc, char **argv)';
assert.equal(source.split(signature).length, 2);
source = source.replace(signature, 'int r55e_matched_main(int argc, char **argv)');
writeFileSync('build/reasoner55_eligible_matched.h', source);
