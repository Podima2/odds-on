import { Platform } from 'react-native'
import { AppIdentity, createSolanaDevnet, SolanaCluster } from '@wallet-ui/react-native-kit'

export class AppConfig {
  static identity: AppIdentity = {
    name: 'OddsOn',
    uri: 'https://oddson.app'
  }
  static networks: SolanaCluster[] = [
    createSolanaDevnet({ url: 'https://api.devnet.solana.com' }),
  ]

  static apiBaseUrl =
    process.env.EXPO_PUBLIC_ODDSON_API_URL ??
    (Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787')

  static oddsonProgramId =
    process.env.EXPO_PUBLIC_ODDSON_PROGRAM_ID ?? 'XJe3F8ygpo8UE4K79PWqgh6FjBefbyU9EbbTvmB6FBs'

  static oracleAuthorityOverride = process.env.EXPO_PUBLIC_ODDSON_ORACLE_AUTHORITY
}
