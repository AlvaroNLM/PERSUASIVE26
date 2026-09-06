// PROVISIONAL EXPERIMENTAL CLASSIFIER
// NOT CLINICALLY VALIDATED
// Replace this isolated rule with a reviewed BALIDA-AA model when available.
export const CLASSIFIER_VERSION = '1.0.0';
export const FEATURE_KEYS = ['difficulty_sustaining_attention', 'distractibility', 'impulsive_responding', 'difficulty_with_changes', 'social_communication_difficulty', 'repetitive_behaviours'];
export const FREQUENCIES = ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'];
export const FEATURE_LABELS = ['Difficulty sustaining attention', 'Distractibility', 'Impulsive responding', 'Difficulty with changes', 'Social communication difficulty', 'Repetitive behaviours'];
export const CASE_FEATURES = Object.freeze(Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, [3, 4, 2, 1, 1, 0][i]])));
export function classifyProfile(features) {
  if (!features || FEATURE_KEYS.some(k => !Number.isInteger(features[k]) || features[k] < 0 || features[k] > 4)) throw new Error('Invalid features');
  const attentionScore = FEATURE_KEYS.slice(0, 3).reduce((sum, key) => sum + features[key], 0);
  const socialScore = FEATURE_KEYS.slice(3).reduce((sum, key) => sum + features[key], 0);
  const classification = attentionScore > socialScore ? 'ADHD_RELATED' : attentionScore < socialScore ? 'ASD_RELATED' : 'INCONCLUSIVE';
  return { classification, explanationFactors: factorsFor(features, classification), attentionScore, socialScore };
}
export function explainClassification(features, classification) {
  const result = classifyProfile(features);
  if (classification !== result.classification) throw new Error('Classification does not match the rule');
  return result.explanationFactors;
}
function factorsFor(features, classification) {
  const indices = classification === 'ADHD_RELATED' ? [0, 1, 2] : classification === 'ASD_RELATED' ? [3, 4, 5] : [];
  const explanationFactors = indices.sort((a, b) => features[FEATURE_KEYS[b]] - features[FEATURE_KEYS[a]]).map(i => ({feature: FEATURE_KEYS[i], value: features[FEATURE_KEYS[i]], contribution: features[FEATURE_KEYS[i]], text: `${FEATURE_LABELS[i]}: ${FREQUENCIES[features[FEATURE_KEYS[i]]].toLowerCase()}`}));
  return explanationFactors;
}
