import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { AppConfig } from '@/constants/app-config'
import { Address, Instruction } from '@solana/kit'
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import { getI64Encoder, getU64Encoder } from '@solana/codecs-numbers'
import QuickCrypto from 'react-native-quick-crypto'

export type PredictionSide = 'YES' | 'NO'

export type CreateMarketInput = {
  title: string
  threshold: number
  timeWindowSeconds: number
  predictionCutoff: string
  eventStartTime: string
  eventEndTime: string
}

export type CreateMarketResult = {
  marketId: bigint
  marketAddress: Address
  vaultAddress: Address
  metadataHashHex: string
  signature: string
}

export interface ProgramClient {
  createMarket(input: CreateMarketInput): Promise<CreateMarketResult>
  placePrediction(marketId: bigint, side: PredictionSide, amountLamports: bigint): Promise<{ signature: string }>
  claimPayout(marketId: bigint): Promise<{ signature: string }>
}

function normalizeWalletError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('CancellationException')) {
    return 'The wallet cancelled the transaction request. Make sure the mock wallet is open on devnet and try again.'
  }

  if (message.toLowerCase().includes('simulation')) {
    return 'The wallet could not simulate the transaction. Verify the connected wallet has devnet SOL and the app is connected to devnet.'
  }

  if (message.includes('No account selected')) {
    return 'Connect a wallet before sending transactions.'
  }

  return message || fallbackMessage
}

const ODDSON_PROGRAM_ADDRESS = address(AppConfig.oddsonProgramId)
const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111')
const CREATE_MARKET_DISCRIMINATOR = new Uint8Array([103, 226, 97, 235, 200, 188, 251, 254])
const PLACE_PREDICTION_DISCRIMINATOR = new Uint8Array([79, 46, 195, 197, 50, 91, 88, 229])
const CLAIM_PAYOUT_DISCRIMINATOR = new Uint8Array([127, 240, 132, 62, 227, 198, 146, 133])
const POSITION_SIDE_DISCRIMINATOR: Record<PredictionSide, number> = {
  YES: 0,
  NO: 1,
}

function concatBytes(...arrays: ReadonlyArray<ArrayLike<number>>) {
  const total = arrays.reduce((sum, current) => sum + current.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const array of arrays) {
    result.set(Array.from(array), offset)
    offset += array.length
  }
  return result
}

function stringToSeed(value: string) {
  return new TextEncoder().encode(value)
}

function unixSecondsFromIso(isoTimestamp: string) {
  return BigInt(Math.floor(new Date(isoTimestamp).getTime() / 1000))
}

function buildMetadataHash(input: CreateMarketInput) {
  const digest = QuickCrypto.createHash('sha256')
    .update(
      JSON.stringify({
        title: input.title,
        threshold: input.threshold,
        timeWindowSeconds: input.timeWindowSeconds,
        predictionCutoff: input.predictionCutoff,
        eventStartTime: input.eventStartTime,
        eventEndTime: input.eventEndTime,
      })
    )
    .digest()

  const bytes = Uint8Array.from(digest)
  const metadataHashBytes = bytes.slice(0, 32)
  const metadataHashHex = Array.from(metadataHashBytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')

  return { metadataHashBytes, metadataHashHex }
}

async function deriveMarketPda(marketId: bigint) {
  const marketIdBytes = getU64Encoder().encode(marketId)
  return getProgramDerivedAddress({
    programAddress: ODDSON_PROGRAM_ADDRESS,
    seeds: [stringToSeed('market'), marketIdBytes],
  })
}

async function deriveVaultPda(marketAddress: Address) {
  return getProgramDerivedAddress({
    programAddress: ODDSON_PROGRAM_ADDRESS,
    seeds: [stringToSeed('vault'), getAddressEncoder().encode(marketAddress)],
  })
}

async function derivePositionPda(marketAddress: Address, userAddress: Address) {
  return getProgramDerivedAddress({
    programAddress: ODDSON_PROGRAM_ADDRESS,
    seeds: [
      stringToSeed('position'),
      getAddressEncoder().encode(marketAddress),
      getAddressEncoder().encode(userAddress),
    ],
  })
}

function buildCreateMarketInstruction(
  creatorAddress: Address,
  marketAddress: Address,
  vaultAddress: Address,
  marketId: bigint,
  input: CreateMarketInput,
  metadataHashBytes: Uint8Array,
  oracleAuthority: Address
): Instruction {
  const data = concatBytes(
    CREATE_MARKET_DISCRIMINATOR,
    getU64Encoder().encode(marketId),
    metadataHashBytes,
    getI64Encoder().encode(unixSecondsFromIso(input.predictionCutoff)),
    getI64Encoder().encode(unixSecondsFromIso(input.eventStartTime)),
    getI64Encoder().encode(unixSecondsFromIso(input.eventEndTime)),
    getAddressEncoder().encode(oracleAuthority)
  )

  return {
    programAddress: ODDSON_PROGRAM_ADDRESS,
    accounts: [
      { address: marketAddress, role: AccountRole.WRITABLE },
      { address: vaultAddress, role: AccountRole.WRITABLE },
      { address: creatorAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data,
  }
}

function buildPlacePredictionInstruction(
  marketAddress: Address,
  positionAddress: Address,
  vaultAddress: Address,
  userAddress: Address,
  side: PredictionSide,
  amountLamports: bigint
): Instruction {
  return {
    programAddress: ODDSON_PROGRAM_ADDRESS,
    accounts: [
      { address: marketAddress, role: AccountRole.WRITABLE },
      { address: positionAddress, role: AccountRole.WRITABLE },
      { address: vaultAddress, role: AccountRole.WRITABLE },
      { address: userAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: concatBytes(
      PLACE_PREDICTION_DISCRIMINATOR,
      new Uint8Array([POSITION_SIDE_DISCRIMINATOR[side]]),
      getU64Encoder().encode(amountLamports)
    ),
  }
}

function buildClaimPayoutInstruction(
  marketAddress: Address,
  positionAddress: Address,
  vaultAddress: Address,
  userAddress: Address
): Instruction {
  return {
    programAddress: ODDSON_PROGRAM_ADDRESS,
    accounts: [
      { address: marketAddress, role: AccountRole.WRITABLE },
      { address: positionAddress, role: AccountRole.WRITABLE },
      { address: vaultAddress, role: AccountRole.WRITABLE },
      { address: userAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: CLAIM_PAYOUT_DISCRIMINATOR,
  }
}

export function useProgramClient(): ProgramClient {
  const { account, sendTransactions } = useMobileWallet()

  function requireAccount() {
    if (!account) {
      throw new Error('Wallet connection is required.')
    }

    return account.address
  }

  return {
    async createMarket(input) {
      try {
        const creatorAddress = requireAccount()
        const marketId = BigInt(Date.now())
        const [marketAddress] = await deriveMarketPda(marketId)
        const [vaultAddress] = await deriveVaultPda(marketAddress)
        const { metadataHashBytes, metadataHashHex } = buildMetadataHash(input)
        if (!AppConfig.oracleAuthorityOverride) {
          throw new Error('EXPO_PUBLIC_ODDSON_ORACLE_AUTHORITY must be configured for market creation.')
        }
        const oracleAuthority = address(AppConfig.oracleAuthorityOverride)

        const signature = await sendTransactions([
          buildCreateMarketInstruction(
            creatorAddress,
            marketAddress,
            vaultAddress,
            marketId,
            input,
            metadataHashBytes,
            oracleAuthority
          ),
        ])

        return {
          marketId,
          marketAddress,
          vaultAddress,
          metadataHashHex,
          signature,
        }
      } catch (error) {
        throw new Error(normalizeWalletError(error, 'Unable to create on-chain market.'))
      }
    },

    async placePrediction(marketId, side, amountLamports) {
      try {
        const userAddress = requireAccount()
        const [marketAddress] = await deriveMarketPda(marketId)
        const [vaultAddress] = await deriveVaultPda(marketAddress)
        const [positionAddress] = await derivePositionPda(marketAddress, userAddress)

        const signature = await sendTransactions([
          buildPlacePredictionInstruction(
            marketAddress,
            positionAddress,
            vaultAddress,
            userAddress,
            side,
            amountLamports
          ),
        ])

        return { signature }
      } catch (error) {
        throw new Error(normalizeWalletError(error, 'Unable to place prediction.'))
      }
    },

    async claimPayout(marketId) {
      try {
        const userAddress = requireAccount()
        const [marketAddress] = await deriveMarketPda(marketId)
        const [vaultAddress] = await deriveVaultPda(marketAddress)
        const [positionAddress] = await derivePositionPda(marketAddress, userAddress)

        const signature = await sendTransactions([
          buildClaimPayoutInstruction(marketAddress, positionAddress, vaultAddress, userAddress),
        ])

        return { signature }
      } catch (error) {
        throw new Error(normalizeWalletError(error, 'Unable to claim payout.'))
      }
    },
  }
}
