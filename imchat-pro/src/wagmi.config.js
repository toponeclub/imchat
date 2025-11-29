// src/wagmi.config.js

import { createConfig, http } from 'wagmi'
import { mainnet, polygon, optimism, arbitrum, base } from 'wagmi/chains'
import { walletConnect } from 'wagmi/connectors'


export const projectId = '9a4485f532467f3b0bb7584537697fd1' 

const metadata = {
  name: 'ImChat Pro',
  description: 'Web3 Chat Application',
  url: 'https://imchat.t1prime.com', 
  icons: ['https://imchat.t1prime.com/vite.svg']
}

const chains = [mainnet, polygon, optimism, arbitrum, base]

export const config = createConfig({
  chains: chains,
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
  },
  connectors: [
    walletConnect({ projectId, metadata, showQrModal: false }), 
  ]
})

export { chains }
