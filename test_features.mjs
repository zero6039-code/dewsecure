import { extractFeatures } from './extensions/chrome/src/phishScoutFeatures.js';

const url = 'https://www.baidu.com/';
const feats = extractFeatures(url);
const nonzero = {};
for (let i = 0; i < feats.length; i++) {
    if (feats[i] !== 0) nonzero[i] = feats[i];
}
console.log("JS 非零特征索引:", Object.keys(nonzero).join(','));
