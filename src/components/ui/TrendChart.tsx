export interface TrendPoint {
  label: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  kind?: 'bar' | 'line';
  /** Formats values for the axis and the accessible summary. */
  formatValue?: (value: number) => string;
  height?: number;
  ariaLabel: string;
}

const WIDTH = 600;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const GRID_LINES = 4;

/**
 * Inline-SVG trend chart. Colour comes from WAYA tokens in the stylesheet, so it
 * follows light and dark themes without the component knowing about them.
 *
 * Deliberately small: it plots one series over time. Categorical comparison is
 * MeterList's job.
 */
export function TrendChart({ points, kind = 'bar', formatValue, height = 180, ariaLabel }: TrendChartProps) {
  const format = formatValue ?? ((value: number) => value.toLocaleString());

  if (points.length === 0) {
    return <p className="data-table-secondary">No data for this period.</p>;
  }

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const peak = Math.max(...points.map((point) => point.value), 1);
  const step = plotWidth / points.length;

  const y = (value: number) => PAD_TOP + plotHeight - (value / peak) * plotHeight;

  const linePath = points
    .map((point, index) => {
      const cx = PAD_LEFT + step * index + step / 2;
      return `${index === 0 ? 'M' : 'L'}${cx.toFixed(1)},${y(point.value).toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${linePath} L${(PAD_LEFT + step * (points.length - 1) + step / 2).toFixed(1)},${(
    PAD_TOP + plotHeight
  ).toFixed(1)} L${(PAD_LEFT + step / 2).toFixed(1)},${(PAD_TOP + plotHeight).toFixed(1)} Z`;

  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={`${ariaLabel}. ${points.length} points, total ${format(total)}.`}
      >
        {Array.from({ length: GRID_LINES + 1 }).map((_, index) => {
          const lineY = PAD_TOP + (plotHeight / GRID_LINES) * index;
          return (
            <line
              key={index}
              className="chart-grid-line"
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={lineY}
              y2={lineY}
            />
          );
        })}

        {kind === 'line' ? (
          <>
            <path className="chart-area" d={areaPath} />
            <path className="chart-line" d={linePath} />
          </>
        ) : (
          points.map((point, index) => {
            const barWidth = Math.max(2, step * 0.55);
            const cx = PAD_LEFT + step * index + (step - barWidth) / 2;
            const top = y(point.value);
            return (
              <rect
                key={point.label}
                className="chart-bar"
                x={cx}
                y={top}
                width={barWidth}
                height={Math.max(1, PAD_TOP + plotHeight - top)}
                rx={2}
              />
            );
          })
        )}

        {points.map((point, index) => {
          // Label the first, middle and last points only, so the axis stays legible.
          const isEdge = index === 0 || index === points.length - 1;
          const isMiddle = index === Math.floor((points.length - 1) / 2);
          if (!isEdge && !isMiddle) return null;
          const cx = PAD_LEFT + step * index + step / 2;
          const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
          return (
            <text key={`label-${point.label}`} className="chart-axis-label" x={cx} y={height - 6} textAnchor={anchor}>
              {point.label}
            </text>
          );
        })}
      </svg>
      <p className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" aria-hidden="true" />
          Peak {format(peak)}
        </span>
        <span className="chart-legend-item">Total {format(total)}</span>
      </p>
    </div>
  );
}
