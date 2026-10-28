/** Product name shown in the shell. Set VITE_APP_NAME to rename without code changes. */
export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined) || 'TrackOja';
export const APP_MARK = APP_NAME.charAt(0).toUpperCase();
