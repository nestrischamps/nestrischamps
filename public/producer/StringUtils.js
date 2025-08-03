/**
 * A simple tagged template literal function that performs standard
 * JavaScript string interpolation.
 *
 * This function is intended primarily to enable syntax highlighting
 * in IDEs (like VS Code with the 'lit-plugin' or 'es6-string-html' extensions)
 * for HTML content within template literals.
 *
 * It does NOT provide any of Lit's reactive rendering, DOM diffing,
 * security features, or other framework-specific functionalities.
 * It simply concatenates the string parts and interpolated values.
 *
 * @param {TemplateStringsArray} strings - The array of string literals.
 * @param {...any} values - The array of interpolated values.
 * @returns {string} The concatenated HTML string.
 */
export function html(strings, ...values) {
	let result = '';
	for (let i = 0; i < strings.length; i++) {
		result += strings[i]; // Add the string part
		if (i < values.length) {
			// Add the interpolated value, ensuring it's converted to a string.
			// In a real templating engine (like Lit's), this is where complex
			// logic for handling nodes, arrays, directives, etc., would go.
			result += String(values[i]);
		}
	}
	return result;
}
