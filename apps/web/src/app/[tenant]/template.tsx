/** Each page in the organization area fades in on navigation (CSS only, off under reduced motion). */
export default function TenantTemplate({ children }: { children: React.ReactNode }) {
  return <div className="anim-fade">{children}</div>;
}
