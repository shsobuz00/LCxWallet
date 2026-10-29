import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Header } from '@/components/Header'
import { ArcBanner } from '@/components/ArcBanner'
import { Dashboard } from '@/components/Dashboard'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import { Ledger } from '@/components/Ledger'
import { usePortfolio } from '@/lib/portfolio'
import { useLedger } from '@/lib/ledger'
import { internalBalance, useVaultStatus } from '@/lib/custody'
import { useWallet } from '@/lib/wallet'
import { ARC_NETWORK } from '@/lib/networks'

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const portfolio = usePortfolio(address)
  const ledger = useLedger(address)
  const walletState = useWallet(address)
  const balances = walletState.wallet?.balances
  const vault = useVaultStatus()
  const [modal, setModal] = useState<'deposit' | 'withdraw' | null>(null)

  const internalUsdc = isConnected && balances ? internalBalance(balances, 'USDC', ARC_NETWORK.chainId) : undefined

  return (
    <div className="min-h-dvh pb-24 font-body text-navy">
      <Header />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <ArcBanner isConnected={isConnected} onArc={chainId === ARC_NETWORK.chainId} internalUsdc={internalUsdc} />
        <Dashboard
          isConnected={isConnected}
          loading={portfolio.isLoading || walletState.isLoading}
          balances={balances}
          syncSource={walletState.wallet?.source}
          syncLive={walletState.live}
          snapshots={portfolio.data}
          vault={vault.data}
          vaultError={vault.error instanceof Error ? vault.error.message : undefined}
          onDeposit={() => setModal('deposit')}
          onWithdraw={() => setModal('withdraw')}
        />
        <Ledger
          rows={ledger.rows}
          isLoading={ledger.isLoading}
          isFetching={ledger.isFetching}
          error={ledger.error}
          isConnected={isConnected}
          onRefresh={() => {
            void ledger.refetch()
            void portfolio.refetch()
            void walletState.refetch()
          }}
        />
      </main>

      <DepositModal
        open={modal === 'deposit'}
        onClose={() => setModal(null)}
        address={address}
        snapshots={portfolio.data}
        depositAddresses={walletState.wallet?.depositAddresses}
        initialChainId={chainId}
      />
      <WithdrawModal
        open={modal === 'withdraw'}
        onClose={() => setModal(null)}
        balances={balances}
        onSubmitted={() => void walletState.refetch()}
      />
    </div>
  )
}
