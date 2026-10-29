import { AuthSplit, HeroSub, HeroTitle } from '@/components/auth/split';
import { getSession } from '@/server/context';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Create your workspace' };

const JOURNEY = ['Register', 'Brand & settings', 'Catalog & booking', 'Quotes & payments', 'Go live'];

export default async function RegisterPage() {
  const session = await getSession();
  const domain = process.env.PLATFORM_APP_DOMAIN || 'tentpole.app';
  return (
    <AuthSplit
      hero={
        <>
          <HeroTitle>Open your rental business on Tentpole.</HeroTitle>
          <HeroSub>Register, make it yours with your brand and rules, then add your catalog and start taking deposits.</HeroSub>
          <div className="anim-rise mt-14 max-w-[600px] -rotate-1 overflow-hidden rounded-[20px] bg-white text-night shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]" style={{ ['--d' as string]: '240ms' }} aria-hidden="true">
            <div className="flex items-center gap-2 bg-[#ECEEF2] px-4 py-3">
              <span className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-[#C5CAD3]" />)}</span>
              <span className="mono ml-2 flex-1 rounded-lg bg-white px-3 py-1.5 text-[13px] text-[#535C6B]">
                https://<b className="text-night">yourbusiness</b>.{domain}<span className="anim-blink ml-px inline-block h-3.5 w-px translate-y-0.5 bg-accent" />
              </span>
            </div>
            <div className="flex">
              <div className="flex w-16 flex-col items-center gap-3 bg-night py-4">
                <span className="grid size-9 place-items-center rounded-lg bg-volt text-xs font-bold">YB</span>
                {[0, 1, 2].map((i) => <span key={i} className="h-1 w-6 rounded-full bg-white/20" />)}
              </div>
              <div className="flex-1 p-6">
                <p className="text-lg font-bold">Your rental business</p>
                <p className="mt-1 text-sm text-[#535C6B]">Workspace ready · onboarding next</p>
                <div className="mt-5 flex gap-2"><span className="anim-grow h-2 w-3/5 rounded-full bg-accent" /><span className="h-2 flex-1 rounded-full bg-[#ECEEF2]" /></div>
              </div>
            </div>
          </div>
          <ol className="mt-14 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-[#A3ABB9]">
            {JOURNEY.map((j, i) => (
              <li key={j} className="anim-rise flex items-center gap-2" style={{ ['--d' as string]: `${400 + i * 120}ms` }}>
                <span className={`size-2 rounded-full ${i === 0 ? 'bg-volt' : i === 1 ? 'bg-[#9BC43A]' : 'bg-[#3A4152]'}`} />
                <span className={i < 2 ? 'text-white' : ''}>{j}</span>
                {i < JOURNEY.length - 1 && <span className="text-[#5B6372]" aria-hidden="true">→</span>}
              </li>
            ))}
          </ol>
        </>
      }
    >
      <RegisterForm domain={domain} signedIn={session ? { name: session.user.name, email: session.user.email } : null} />
    </AuthSplit>
  );
}
