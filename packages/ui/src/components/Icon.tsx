import React from 'react';

/**
 * Inline icon set (24×24, stroke-based) so navigation, toolbars and status
 * rows can carry the iconography the UI spec calls for without adding a
 * dependency to the workspace.
 */
const PATHS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  home: 'M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9',
  truck:
    'M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  check: 'm5 12 4 4L19 6',
  'check-square':
    'M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  approvals: 'M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M9 3h6v4H9V3Zm0 10h6',
  finance: 'M3 7h18v10H3V7Zm3 4h4m2 0h4M6 12h.01M18 12h.01',
  sales: 'M3 6h2l2.5 10h9L19 9H6M9 20h.01M17 20h.01',
  procurement: 'M3 7h9v9H3V7Zm9 3h9v6h-9v-6ZM6 20h12',
  inventory: 'M4 7h16v13H4V7Zm0 0 2-3h12l2 3M9 12h6',
  hr: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm12.5 9v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  payroll: 'M12 3v18M8 7h5a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6',
  assets: 'M4 8h16v11H4V8Zm3 11V8m4 11V8m4 11V8M3 5h18v3H3V5Z',
  reports: 'M4 20V9m5 11V4m5 16v-7m5 7V7',
  documents: 'M14 3v5h5M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-4-5Zm0 0v5h5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.9-1.7L14.2 2H9.8L9.4 4.7a8 8 0 0 0-2.9 1.7l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.9 1.7l.4 2.7h4.4l.4-2.7a8 8 0 0 0 2.9-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.5-1.5L21 21',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.5 20a2 2 0 0 0 3 0',
  calendar:
    'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  print:
    'M7 8V4h10v4M7 17H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M7 14h10v6H7v-6Z',
  share: 'M12 3v13m0-13 4 4m-4-4-4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4',
  edit: 'M4 20h4l10-10-4-4L4 16v4Zm10-14 4 4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 5v14m0 0 6-6m-6 6-6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout:
    'M15 12H4m0 0 4-4m-4 4 4 4m5-9V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2',
  building:
    'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
  cart: 'M3 4h2l2.4 11h10L20 7H6M9 20h.01M17 20h.01',
  trendUp: 'M3 17l6-6 4 4 7-7m0 0h-5m5 0v5',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  wallet:
    'M3 8a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 8v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Zm14 4h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2',
  send: 'M21 3 3 10.5l7 3 3 7L21 3Z',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 21V9m0 0 4 4m-4-4-4 4M4 5h16',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z',
  globe:
    'M4 12a8 8 0 1 1 16 0A8 8 0 0 1 4 12Zm0 0a8 8 0 1 0 16 0A8 8 0 0 0 4 12Zm3.5-9a5.5 5.5 0 0 1 7.5 0v.5h1.5a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0v-1.5h-1.5a.5.5 0 0 1 0-1v-.5A5.5 5.5 0 0 1 7.5 3Z',
  externalLink:
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h2a2 2 0 0 1 2 2v4m0 0-2 2m2-2-2-2m-7 7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2',
  documentExport: 'M4 4h12v12H4Zm1.5 1.5 4 4m0-4-4 4m4-4h5v5H8.5V5.5Z',
  qrCode:
    'M3 3h18v18H3V3Zm3 3v3h3V6H6ZM12 12h3v3h-3V12ZM6 12h3v3H6v-3ZM6 18h3v3H6v-3Zm12-6h3v3h-3v-3ZM12 6h3v3h-3V6Z',
  organization:
    'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
};

export type IconName = keyof typeof PATHS;

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
}

/**
 * Renders a named icon. Unknown names fall back to a neutral dot rather than
 * throwing, so a new navigation entry can never blank the shell.
 */
export function Icon({ name, size = 18, className = '', ...rest }: IconProps) {
  const path = PATHS[name] ?? 'M12 12h.01';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}
