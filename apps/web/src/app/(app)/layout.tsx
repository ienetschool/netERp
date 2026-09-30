import { RouteGuard } from '@/components/RouteGuard';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard>{children}</RouteGuard>;
}
