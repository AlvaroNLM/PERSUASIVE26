// Fixed, read-only research stimulus. Independent of the replaceable classifier.
export const FEATURE_KEYS = ['difficulty_sustaining_attention', 'distractibility', 'impulsive_responding', 'difficulty_with_changes', 'social_communication_difficulty', 'repetitive_behaviours'];
export const FREQUENCIES = ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'];
export const FEATURE_LABELS = ['Difficulty sustaining attention', 'Distractibility', 'Impulsive responding', 'Difficulty with changes', 'Social communication difficulty', 'Repetitive behaviours'];
export const CASE_FEATURES = Object.freeze(Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, [3, 4, 2, 1, 1, 0][i]])));
