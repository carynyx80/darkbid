import Logo from "../components/Logo";
import Reveal from "../components/Reveal";
import WaitlistForm from "../components/WaitlistForm";

const steps = [
  ["01", "Buy a ticket", "Prove you’re on the allowlist without saying who you are, then pay for identical tickets. Every ticket costs the same, so amounts say nothing."],
  ["02", "The sale closes", "Claims stay locked until the sale ends. Every buyer is hidden among all the others before a single token moves."],
  ["03", "Claim anywhere", "Redeem each ticket to any wallet you choose, through a relayer. Nothing on-chain ties it to the wallet that paid."],
];

const hidden = ["Which allowlisted buyer bought", "Which wallet received which tokens", "How much any buyer holds afterwards"];
const visible = ["That a wallet paid for a ticket", "How many tickets were sold in total", "The price and terms of the sale"];

const saleTypes = [
  ["Presale", "First", "Fixed price, allowlisted, identical tickets."],
  ["ICO", "Planned", "Sealed bids that clear at a single price."],
  ["IDO", "Planned", "Private allocation, then straight into liquidity."],
  ["IPO", "Planned", "Tokenized shares with a hidden cap table and an auditor key."],
];

const networks = [
  ["Robinhood Chain", "Sales run natively on Robinhood Chain. Payments, tickets and claims all stay there."],
  ["Solana", "Sales run natively on Solana. Payments, tickets and claims all stay there."],
];

function SectionHead({ label, title }) {
  return (
    <Reveal className="section-head">
      <p className="label">{label}</p>
      <h2>{title}</h2>
    </Reveal>
  );
}

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top" aria-label="Darkbid home">
            <Logo width={50} />
            <span>Darkbid</span>
          </a>
          <nav className="nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a href="#sales">Sale types</a>
            <a href="#networks">Networks</a>
          </nav>
          <div className="nav-actions">
            <a className="nav-app" href="/app/register">
              Host a launch
            </a>
            <a className="nav-app" href="/app">
              Launch app
            </a>
            <a className="button-outline" href="#waitlist">
              Join waitlist
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="opening" id="waitlist">
          <div className="wrap opening-inner">
            <div className="opening-text">
              <Reveal as="p" className="label">
                Private launchpad / Robinhood Chain / Solana
              </Reveal>
              <Reveal as="h1" delay={0.08}>
                Raise in the dark.
              </Reveal>
              <Reveal as="p" delay={0.16} className="lede">
                Darkbid runs token sales where nobody can link a buyer to their tokens. Not the public, not the issuer, not us.
              </Reveal>
              <Reveal delay={0.24}>
                <WaitlistForm />
              </Reveal>
            </div>
            <Reveal delay={0.2} className="opening-mark">
              <Logo width={400} />
            </Reveal>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <SectionHead label="How it works" title="Three steps. No trail." />
            <div className="grid grid-3">
              {steps.map(([n, title, text], i) => (
                <Reveal key={n} delay={i * 0.08} className="card">
                  <p className="label">{n}</p>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="privacy">
          <div className="wrap">
            <SectionHead label="What stays dark" title="Honest about the limits." />
            <div className="grid grid-2">
              <Reveal className="card">
                <h3>Hidden from everyone</h3>
                <ul className="list list-hidden">
                  {hidden.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={0.08} className="card card-muted">
                <h3>Still visible</h3>
                <ul className="list list-visible">
                  {visible.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="section" id="sales">
          <div className="wrap">
            <SectionHead label="Sale types" title="One engine. Four ways to raise." />
            <div className="grid grid-4">
              {saleTypes.map(([name, status, text], i) => (
                <Reveal key={name} delay={i * 0.06} className="card">
                  <span className={`tag ${i === 0 ? "tag-solid" : ""}`}>{status}</span>
                  <h3 className="type-name">{name}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="networks">
          <div className="wrap">
            <SectionHead label="Networks" title="Two chains. Kept apart." />
            <div className="grid grid-2">
              {networks.map(([name, text], i) => (
                <Reveal key={name} delay={i * 0.08} className="card">
                  <p className="label">Network 0{i + 1}</p>
                  <h3 className="network-name">{name}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
            <Reveal as="p" className="section-note">
              No bridge. A sale lives on one chain from the first ticket to the last claim.
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="footer-brand">
            <Logo width={62} />
            <p className="label label-muted">© 2026 Darkbid</p>
          </div>
          <p className="footer-legal">
            Darkbid is in development. Nothing on this site is an offer to sell tokens or securities, and availability will depend on
            your country.
          </p>
        </div>
      </footer>
    </>
  );
}
