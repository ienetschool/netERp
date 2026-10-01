import { redirect } from 'next/navigation';

/** The shell links to "/" (logo); send it to the dashboard. */
export default function RootPage(): never {
  redirect('/dashboard');
}
