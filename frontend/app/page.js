import Logo from "../components/Logo";
import Reveal from "../components/Reveal";

const steps = [
  ["1", "Grab a ticket", "Prove you’re on the list without saying who you are. Every ticket costs the same, so the amount gives nothing away."],
  ["2", "Wait for the curtain", "Claims stay locked until the sale ends, so you’re lost in the crowd before a single token moves."],
  ["3", "Claim anywhere", "Send your tokens to any wallet you like. Nothing on-chain links it back to the one that paid."],
];

const hidden = ["Which allowlisted buyer bought", "Which wallet got which tokens", "How much anyone holds afterwards"];
const visible = ["That some wallet paid for a ticket", "How many tickets sold in total", "The price and the rules of the sale"];

const saleTypes = [
  ["Presale", "First up", "Fixed price, allowlisted, identical tickets."],
  ["ICO", "Coming", "Sealed bids that all clear at one price."],
  ["IDO", "Coming", "Private allocation, then straight into liquidity."],
  ["IPO", "Coming", "Tokenized shares with a hidden cap table."],
];

const networks = [
  ["Robinhood Chain", "Sales live entirely on Robinhood Chain: pay, get a ticket, claim, all in one place."],
  ["Solana", "Sales live entirely on Solana: pay, get a ticket, claim, all in one place."],
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
            <a className="button-outline" href="/app">
              Open the app
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="opening">
          <div className="wrap opening-inner">
            <div className="opening-text">
              <Reveal as="p" className="label">
                Private launchpad · Robinhood Chain · Solana
              </Reveal>
              <Reveal as="h1" delay={0.08}>
                Raise in the <span className="scribble">dark</span>.
              </Reveal>
              <Reveal as="p" delay={0.16} className="lede">
                Token sales where nobody can tell who bought what. Not the public, not the project, not even us.
              </Reveal>
              <Reveal delay={0.24} className="hero-ctas">
                <a className="button-solid" href="/app">
                  Browse launches
                </a>
                <a className="button-ghost hero-ghost" href="/app/register">
                  Host a launch
                </a>
              </Reveal>
              <Reveal as="p" delay={0.3} className="hero-note">
                <span className="sticker">psst</span> No sign-up. No email. Just you and some very fancy maths.
              </Reveal>
            </div>
            <Reveal delay={0.2} className="opening-mark">
              <Logo width={400} />
            </Reveal>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <SectionHead label="How it works" title="Three steps. Zero trail." />
            <div className="grid grid-3">
              {steps.map(([n, title, text], i) => (
                <Reveal key={n} delay={i * 0.08} className="card">
                  <span className="step-bubble">{n}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="privacy">
          <div className="wrap">
            <SectionHead label="What stays secret" title="No smoke, no mirrors." />
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
                <h3>Still out in the open</h3>
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
            <SectionHead label="Sale types" title="One engine, four flavours." />
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
            <SectionHead label="Networks" title="Two chains, no drama." />
            <div className="grid grid-2">
              {networks.map(([name, text], i) => (
                <Reveal key={name} delay={i * 0.08} className="card">
                  <p className="label">Network {i + 1}</p>
                  <h3 className="network-name">{name}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </div>
            <Reveal as="p" className="section-note">
              No bridges. A sale stays on its chain from the first ticket to the last claim.
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="footer-brand">
            <Logo width={62} />
            <p className="label label-muted">© 2026 Darkbid</p>
            <a className="footer-link" href="/feed.xml">
              Launch feed (RSS)
            </a>
          </div>
          <p className="footer-legal">
            Darkbid is still being built. Nothing here is an offer to sell tokens or securities, and availability depends on where you live.
          </p>
        </div>
      </footer>
    </>
  );
}
