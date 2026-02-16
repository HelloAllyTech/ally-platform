import {EmotionalMovementDataset} from '@/screens/SimulationFeedbackScreen/components/SessionSkills/SessionSkills';

import {formatTimeToMMSS} from './date';

/**
 * Utility function to generate a Map of uniformly spaced x-axis labels (in ms + formatted string)
 * for emotional movement datasets.
 */
export function getNormalisedXAxisLabelsMap(
  datasets: EmotionalMovementDataset[] = [],
  formatFn: (ms: number) => string = formatTimeToMMSS,
  numIntervals: number = 5,
): Map<number, string> {
  if (!datasets.length) return new Map();

  const allTimes = datasets
    .flatMap(d => d.data)
    .filter(x => typeof x === 'object' && 'x' in x && typeof x.x === 'number');
  if (!allTimes.length) return new Map();

  const minTime = Math.min(...allTimes.map(x => x.x));
  const maxTime = Math.max(...allTimes.map(x => x.x));

  const interval = (maxTime - minTime) / numIntervals;

  return new Map(
    Array.from({length: numIntervals + 1}, (_, idx) => [
      Math.round((minTime + idx * interval) * 1000),
      formatFn(Math.round((minTime + idx * interval) * 1000)),
    ]),
  );
}

/**
 * Linearly interpolate the Y value at `targetX` from a **sorted** (by x) array of {x, y} points.
 * If targetX falls outside the data range the nearest endpoint's y is returned.
 */
export function interpolateY(
  sortedData: {x: number; y: number}[],
  targetX: number,
): number {
  if (!sortedData.length) return 0;
  if (targetX <= sortedData[0].x) return sortedData[0].y;
  if (targetX >= sortedData[sortedData.length - 1].x)
    return sortedData[sortedData.length - 1].y;

  for (let i = 0; i < sortedData.length - 1; i++) {
    const p1 = sortedData[i];
    const p2 = sortedData[i + 1];
    if (targetX >= p1.x && targetX <= p2.x) {
      const t = (targetX - p1.x) / (p2.x - p1.x);
      return p1.y + t * (p2.y - p1.y);
    }
  }

  return sortedData[sortedData.length - 1].y;
}

/**
 * For each dataset, compute the interpolated Y values at the normalised
 * (uniformly-spaced) X-axis positions so that dots appear exactly on the
 * X-axis gridlines.
 */
export function getInterpolatedYValues(
  datasets: EmotionalMovementDataset[],
  numIntervals: number = 5,
): number[][] {
  if (!datasets.length) return [];

  const allPoints = datasets
    .flatMap(d => d.data)
    .filter(
      (pt): pt is {x: number; y: number} =>
        typeof pt === 'object' && 'x' in pt && typeof pt.x === 'number',
    );
  if (!allPoints.length) return datasets.map(() => []);

  const minTime = Math.min(...allPoints.map(pt => pt.x));
  const maxTime = Math.max(...allPoints.map(pt => pt.x));
  const interval = (maxTime - minTime) / numIntervals;

  // The same uniformly-spaced x positions used by getNormalisedXAxisLabelsMap
  const normalisedXPositions = Array.from(
    {length: numIntervals + 1},
    (_, idx) => minTime + idx * interval,
  );

  return datasets.map(dataset => {
    const sorted = [...dataset.data]
      .filter(
        (pt): pt is {x: number; y: number} =>
          typeof pt === 'object' && 'x' in pt && typeof pt.x === 'number',
      )
      .sort((a, b) => a.x - b.x);

    return normalisedXPositions.map(
      x => Math.round(interpolateY(sorted, x) * 1000) / 1000,
    );
  });
}
