import { MobileOsSelect } from '@/components/MobileOsSelect';

export default function MobileHomePage() {
  return (
    <main className="page">
      <h1 className="hero-title">Select Android or iOS</h1>
      <p className="hero-sub">
        After you pick a platform, you will add the Drive app URL and Appium server URL.
      </p>
      <MobileOsSelect />
    </main>
  );
}
