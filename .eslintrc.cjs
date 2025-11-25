/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
	root: true,
	extends: ['@remix-run/eslint-config', '@remix-run/eslint-config/node', 'prettier'],
	parserOptions: {
		project: './tsconfig.json',
	},
	globals: {
		shopify: 'readonly',
	},
	rules: {
		'@typescript-eslint/no-explicit-any': 'error',
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/await-thenable': 'error',
		'no-restricted-syntax': [
			'error',
			{
				selector: 'TSAsExpression[typeAnnotation.typeName.name="any"]',
				message: 'Type assertion to "any" is not allowed. Use proper types instead.',
			},
		],
	},
};
