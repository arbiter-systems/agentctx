export const PRIMARY_COMMAND_NAME = "instv";

export type Preview<T> = {
  visible: T[];
  omittedCount: number;
};

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

export function previewItems<T>(items: T[], limit: number): Preview<T> {
  const safeLimit = Math.max(0, limit);
  const visible = items.slice(0, safeLimit);
  return {
    visible,
    omittedCount: Math.max(0, items.length - visible.length),
  };
}

export function sumTokens(items: Array<{ estimatedTokens: number }>): number {
  return items.reduce((total, item) => total + item.estimatedTokens, 0);
}

export function optionalBlock<T>(
  value: T | undefined,
  format: (value: T) => string[],
): string[] {
  return value === undefined ? [] : ["", ...format(value)];
}
