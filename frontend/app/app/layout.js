import WalletProvider from "../../components/app/WalletProvider";
import AppFrame from "../../components/app/AppFrame";

export const metadata = {
  title: "Darkbid app",
  description: "Private token launches on Robinhood Chain and Solana.",
  alternates: { types: { "application/rss+xml": [{ url: "/feed.xml", title: "Darkbid launches" }] } },
};

export default function AppLayout({ children }) {
  return (
    <WalletProvider>
      <AppFrame>{children}</AppFrame>
    </WalletProvider>
  );
}
