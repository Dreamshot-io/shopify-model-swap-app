/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
	root: true,
	extends: ['@remix-run/eslint-config', '@remix-run/eslint-config/node', 'prettier'],
	globals: {
		shopify: 'readonly',
	},
	rules: {
		'@typescript-eslint/no-explicit-any': 'error',
		'no-restricted-syntax': [
			'error',
			{
				selector: 'TSAsExpression[typeAnnotation.typeName.name="any"]',
				message: 'Type assertion to "any" is not allowed. Use proper types instead.',
			},
		],
	},
};
