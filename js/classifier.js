// PROVISIONAL EXPERIMENTAL CLASSIFIER
// NOT CLINICALLY VALIDATED
// Replace this isolated rule with a reviewed BALIDA-AA model when available.
export const CLASSIFIER_VERSION = '1.0.0';
import { FEATURE_KEYS, FEATURE_LABELS, FREQUENCIES } from './case.js';
export function classifyProfile(features) {
  if (!features || FEATURE_KEYS.some(k => !Number.isInteger(features[k]) || features[k] < 0 || features[k] > 4)) throw new Error('Invalid features');
  const attentionScore = FEATURE_KEYS.slice(0, 3).reduce((sum, key) => sum + features[key], 0);
  const socialScore = FEATURE_KEYS.slice(3).reduce((sum, key) => sum + features[key], 0);
  const classification = attentionScore > socialScore ? 'ADHD_RELATED' : attentionScore < socialScore ? 'ASD_RELATED' : 'INCONCLUSIVE';
  return { classification, explanationFactors: factorsFor(features, classification), attentionScore, socialScore };
}
export function explainClassification(features, result) {
  const computed = classifyProfile(features);
  if (!result || result.classification !== computed.classification) throw new Error('Classification does not match the rule');
  return computed.explanationFactors;
}
function factorsFor(features, classification) {
  const indices = classification === 'ADHD_RELATED' ? [0, 1, 2] : classification === 'ASD_RELATED' ? [3, 4, 5] : [];
  const explanationFactors = indices.sort((a, b) => features[FEATURE_KEYS[b]] - features[FEATURE_KEYS[a]]).map(i => ({feature: FEATURE_KEYS[i], value: features[FEATURE_KEYS[i]], contribution: features[FEATURE_KEYS[i]], text: `${FEATURE_LABELS[i]}: ${FREQUENCIES[features[FEATURE_KEYS[i]]].toLowerCase()}`}));
  return explanationFactors;
}
