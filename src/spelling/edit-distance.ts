export function boundedDamerauLevenshtein(left: string, right: string, maximum: number): number | null {
	const a = [...left];
	const b = [...right];
	if (Math.abs(a.length - b.length) > maximum) return null;

	let previousPrevious = new Array(b.length + 1).fill(0) as number[];
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

	for (let row = 1; row <= a.length; row++) {
		const current = new Array(b.length + 1).fill(maximum + 1) as number[];
		current[0] = row;
		let rowMinimum = current[0];

		for (let column = 1; column <= b.length; column++) {
			const substitution = a[row - 1] === b[column - 1] ? 0 : 1;
			let distance = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + substitution,
			);
			if (row > 1 && column > 1
				&& a[row - 1] === b[column - 2]
				&& a[row - 2] === b[column - 1]) {
				distance = Math.min(distance, previousPrevious[column - 2] + 1);
			}
			current[column] = distance;
			rowMinimum = Math.min(rowMinimum, distance);
		}
		if (rowMinimum > maximum) return null;
		previousPrevious = previous;
		previous = current;
	}

	const distance = previous[b.length];
	return distance <= maximum ? distance : null;
}
