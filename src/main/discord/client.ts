// Adapts @xhayper/discord-rpc's Client to the RpcClient the presence service uses.
import { Client } from '@xhayper/discord-rpc'
import type { RpcClient } from './presence'

export function createRpcClient(appId: string): RpcClient {
  const client = new Client({ clientId: appId, transport: { type: 'ipc' } })
  return {
    // No scopes: just connects over the local IPC pipe, no OAuth prompt.
    login: () => client.login(),
    async setActivity(activity) {
      if (!client.user) throw new Error('Not connected to Discord.')
      await client.user.setActivity(activity)
    },
    async clearActivity() {
      await client.user?.clearActivity()
    },
    destroy: () => client.destroy(),
    onDisconnected(listener) {
      client.on('disconnected', listener)
    }
  }
}
