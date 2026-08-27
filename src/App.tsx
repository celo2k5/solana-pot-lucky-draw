import { useEffect, useRef, useState } from 'react'
import { Activity, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Trophy, Wallet } from 'lucide-react'
import potMark from './assets/hero.png'
import './App.css'

const SOCKET_URL = import.meta.env.VITE_DISTRIBUTION_SOCKET_URL || 'wss://marcelo1.up.railway.app'

type TokenMetadata = { mint: string | null; symbol: string; name: string; image: string | null }
type Transfer = { wallet: string; amount: number; signature: string | null; status: string; tokenSymbol?: string; tokenMint?: string; tokenMetadata?: TokenMetadata }
type Cycle = { active: boolean; phase?: string; tokenChosen?: TokenMetadata | null; holdersCount?: number; transfersCompleted?: number }
type StateData = {
  config?: { robinhoodMode?: string | boolean; distributionTokens?: string[]; distributionTokenMetadata?: TokenMetadata[] }
  schedulerRunning?: boolean; nextDistributionTime?: string | null; secondsRemaining?: number; creatorBalance?: number
  holders?: Array<{ wallet: string }>; currentCycle?: Cycle; history?: Array<{ round: number; status: string }>
}
type SocketMessage = { type: string; data: unknown }

const phases: Record<string, string> = { claiming_fees: 'Collecting fees', fetching_holders: 'Checking entries', swapping: 'Preparing prize', distributing: 'Sending prizes', completed: 'Draw complete', failed: 'Draw paused' }
const shortWallet = (value?: string | null) => value ? `${value.slice(0, 6)}...${value.slice(-4)}` : 'Awaiting wallet'
const amount = (value?: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 }).format(value || 0)
const safeImage = (url?: string | null) => Boolean(url && /^https?:\/\//i.test(url))

function TokenBadge({ metadata, symbol }: { metadata?: TokenMetadata; symbol?: string }) {
  const [failed, setFailed] = useState(false)
  const label = metadata?.symbol || symbol || 'SOL'
  return safeImage(metadata?.image) && !failed
    ? <img className="token-badge" src={metadata?.image || undefined} alt={`${label} token`} onError={() => setFailed(true)} />
    : <span className="token-badge token-fallback">{label.slice(0, 4)}</span>
}

function App() {
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [state, setState] = useState<StateData>({})
  const [cycle, setCycle] = useState<Cycle>({ active: false })
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [metadataByMint, setMetadataByMint] = useState<Record<string, TokenMetadata>>({})
  const [now, setNow] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let retryTimer: number | undefined
    let retryMs = 1000
    let manuallyClosed = false
    const mergeMetadata = (items: TokenMetadata[] = []) => setMetadataByMint((previous) => {
      const next = { ...previous }
      items.forEach((item) => { if (item?.mint) next[item.mint] = item })
      return next
    })
    const addTransfer = (transfer: Transfer) => {
      if (transfer.tokenMetadata?.mint) mergeMetadata([transfer.tokenMetadata])
      setTransfers((previous) => {
        const identity = `${transfer.signature || ''}:${transfer.wallet}`
        return [transfer, ...previous.filter((item) => `${item.signature || ''}:${item.wallet}` !== identity)].slice(0, 10)
      })
    }
    const handleMessage = (message: SocketMessage) => {
      const data = message.data as Record<string, unknown>
      if (message.type === 'state') {
        const snapshot = message.data as StateData
        setState(snapshot); setCycle(snapshot.currentCycle || { active: false }); mergeMetadata(snapshot.config?.distributionTokenMetadata)
      } else if (message.type === 'token_metadata') {
        mergeMetadata((message.data as TokenMetadata[]) || [])
      } else if (message.type === 'tx_history') {
        const history = (message.data as Array<{ type: string; data: Transfer }>) || []
        const restored = history.filter((item) => item.type === 'transfer').map((item) => item.data).reverse()
        restored.forEach((transfer) => { if (transfer.tokenMetadata?.mint) mergeMetadata([transfer.tokenMetadata]) })
        setTransfers(restored)
      } else if (message.type === 'tick' || message.type === 'scheduler_state') {
        setState((previous) => ({ ...previous, ...(data as StateData) }))
      } else if (message.type === 'holders_update') {
        setState((previous) => ({ ...previous, holders: message.data as Array<{ wallet: string }> }))
      } else if (message.type === 'cycle_start' || message.type === 'cycle_update') {
        const update = message.data as Cycle
        setCycle(update); if (update.tokenChosen?.mint) mergeMetadata([update.tokenChosen])
      } else if (message.type === 'cycle_end') {
        const ended = data.cycle as Cycle | undefined
        setCycle({ ...(ended || { active: false }), active: false, phase: 'completed' })
        setState((previous) => ({ ...previous, history: (data.history as StateData['history']) || previous.history }))
      } else if (message.type === 'transfer') {
        addTransfer(message.data as Transfer)
        setCycle((previous) => ({ ...previous, transfersCompleted: (previous.transfersCompleted || 0) + 1 }))
      }
    }
    const connect = () => {
      setConnection(retryMs === 1000 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(SOCKET_URL)
      socketRef.current = socket
      socket.addEventListener('open', () => { retryMs = 1000; setConnection('live') })
      socket.addEventListener('message', (event) => { try { const parsed = JSON.parse(event.data) as SocketMessage; if (typeof parsed?.type === 'string') handleMessage(parsed) } catch { /* Ignore malformed server messages. */ } })
      socket.addEventListener('error', () => socket.close())
      socket.addEventListener('close', () => {
        if (manuallyClosed) return
        setConnection('reconnecting'); retryTimer = window.setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 15000)
      })
    }
    connect()
    return () => { manuallyClosed = true; window.clearTimeout(retryTimer); socketRef.current?.close() }
  }, [])

  const seconds = state.nextDistributionTime && now ? Math.max(0, Math.round((new Date(state.nextDistributionTime).getTime() - now) / 1000)) : state.secondsRemaining || 0
  const clock = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, '0'))
  const progress = cycle.holdersCount ? Math.min(100, ((cycle.transfersCompleted || 0) / cycle.holdersCount) * 100) : 0
  const recipient = transfers[0]
  const phase = phases[cycle.phase || ''] || (cycle.active ? 'Drawing winner' : 'Standing by')
  const liveMode = state.config?.robinhoodMode === 'luckyv1'

  return (
    <main className="app-shell">
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#draw"><span className="brand-mark"><img src={potMark} alt="" /></span><span>SOLANA <b>POT</b></span></a>
        <div className="header-status"><span className={`connection connection-${connection}`}><i />{connection}</span><button className="icon-button" type="button" title="Reconnect to live feed" onClick={() => socketRef.current?.close()}><RefreshCw size={17} /></button></div>
      </header>
      <section className="draw-stage" id="draw">
        <div className="stage-copy"><div className="eyebrow"><Sparkles size={15} /> Lucky draw distribution</div><h1>Every holder<br />has a shot.</h1><p>Live distribution tech for the Solana Pot community.</p></div>
        <div className={`machine ${cycle.active ? 'machine-active' : ''}`}><div className="machine-top"><span>LUCKY DRAW</span><span className="machine-dot" /></div><div className="reels">{[0, 1, 2].map((reel) => <div className="reel" key={reel}><span className="sol-mark">S</span></div>)}</div><div className="machine-base"><span>POWERED BY</span><strong>SOLANA</strong></div>{cycle.active && <div className="winner-pulse"><Trophy size={18} /> Drawing live</div>}</div>
        <aside className="countdown-panel"><span className="panel-kicker">Next draw</span><div className="time-display">{clock.map((unit, index) => <span key={`${unit}-${index}`}>{unit}{index < 2 && <b>:</b>}</span>)}</div><div className="countdown-labels"><span>HRS</span><span>MIN</span><span>SEC</span></div><div className="mode-line"><ShieldCheck size={15} /> {liveMode ? 'Lucky v1 verified' : 'Waiting for luckyv1 mode'}</div></aside>
      </section>
      <section className="metrics"><div><span>Eligible entries</span><strong>{state.holders?.length || 0}</strong><small>holders in the draw</small></div><div><span>Prize wallet</span><strong>{amount(state.creatorBalance)} <em>SOL</em></strong><small>live creator balance</small></div><div><span>Draw status</span><strong className={cycle.active ? 'active-value' : ''}>{phase}</strong><small>{cycle.active ? `${cycle.transfersCompleted || 0} paid this round` : 'listening for next cycle'}</small></div></section>
      <section className="content-grid">
        <article className="recipient-panel"><div className="section-heading"><div><span className="eyebrow"><Trophy size={15} /> Latest recipient</span><h2>{recipient ? 'Pot landed.' : 'The pot is warming up.'}</h2></div><Activity size={20} /></div>{recipient ? <div className="recipient-content"><TokenBadge metadata={recipient.tokenMetadata || metadataByMint[recipient.tokenMint || '']} symbol={recipient.tokenSymbol} /><div className="recipient-amount"><strong>{amount(recipient.amount)}</strong><span>{recipient.tokenMetadata?.symbol || recipient.tokenSymbol || 'TOKEN'} sent</span></div><a className="wallet-link" href={recipient.signature ? `https://solscan.io/tx/${encodeURIComponent(recipient.signature)}` : undefined} target="_blank" rel="noreferrer"><Wallet size={16} /> {shortWallet(recipient.wallet)} {recipient.signature && <ExternalLink size={14} />}</a></div> : <div className="empty-state"><LoaderCircle size={20} /> Waiting for the first transfer event.</div>}</article>
        <article className="progress-panel"><div className="section-heading"><div><span className="eyebrow"><Activity size={15} /> Cycle monitor</span><h2>{phase}</h2></div><span className={cycle.active ? 'live-chip' : 'idle-chip'}>{cycle.active ? 'LIVE' : 'IDLE'}</span></div><div className="progress-rail"><span style={{ width: `${progress}%` }} /></div><div className="progress-detail"><span>{cycle.transfersCompleted || 0} transfers</span><span>{cycle.holdersCount || 0} recipients</span></div>{cycle.tokenChosen && <div className="chosen-token"><TokenBadge metadata={cycle.tokenChosen} /><span>Now drawing <b>{cycle.tokenChosen.symbol}</b></span></div>}</article>
      </section>
      <section className="feed-section"><div className="feed-heading"><div><span className="eyebrow"><Activity size={15} /> On-chain activity</span><h2>Live transfer feed</h2></div><span>{transfers.length} recent</span></div><div className="transfer-list">{transfers.length ? transfers.map((transfer, index) => { const metadata = transfer.tokenMetadata || metadataByMint[transfer.tokenMint || '']; return <div className="transfer-row" key={`${transfer.signature || index}-${transfer.wallet}`}><TokenBadge metadata={metadata} symbol={transfer.tokenSymbol} /><span className="row-wallet">{shortWallet(transfer.wallet)}</span><span className="row-amount">{amount(transfer.amount)} {metadata?.symbol || transfer.tokenSymbol || 'TOKEN'}</span><span className={`tx-status status-${transfer.status}`}>{transfer.status}</span>{transfer.signature ? <a href={`https://solscan.io/tx/${encodeURIComponent(transfer.signature)}`} target="_blank" rel="noreferrer" title="View on Solscan"><ExternalLink size={17} /></a> : <span className="no-link">-</span>}</div> }) : <div className="feed-empty"><CircleAlert size={18} /> The live feed will populate after the server sends transaction history or a transfer.</div>}</div></section>
      <footer>Solana Pot distribution engine <span>{connection === 'live' ? 'connected in real time' : 'reconnecting to the draw'}</span></footer>
    </main>
  )
}

export default App
