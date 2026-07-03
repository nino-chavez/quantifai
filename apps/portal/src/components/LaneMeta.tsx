import { StatusBadge, type Status } from '@blueprint/ui';

export interface LaneMetaProps {
  status: Status;
  sections: number;
}

/**
 * Meta line for a LaneCard on the homepage — status badge + optional
 * section count. Extracted to a React component because Astro's parser
 * struggles with JSX fragments inside .astro prop expressions.
 */
export function LaneMeta({ status, sections }: LaneMetaProps) {
  return (
    <>
      <StatusBadge status={status} />
      {sections > 0 && (
        <span>
          · {sections} {sections === 1 ? 'section' : 'sections'}
        </span>
      )}
    </>
  );
}
