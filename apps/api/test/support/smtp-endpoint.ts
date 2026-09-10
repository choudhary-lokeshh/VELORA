/* eslint-disable no-restricted-imports -- A test harness that stands one SMTP endpoint up in this process. It is not runtime code and no composition root can reach it; the runtime rule is enforced on `apps/api/src`, where this deliberately does not live. */
import { createServer, type Server, type Socket } from 'node:net';

/**
 * A submission endpoint that answers, and can be told to refuse an upgrade.
 *
 * It exists to prove one property and only one: that the adapter stops rather
 * than continuing in cleartext. It never completes a TLS handshake, so nothing
 * here is evidence that a real endpoint would accept a message — that is
 * `PROVIDER CREDENTIAL REQUIRED` and is not claimed anywhere.
 */
export interface FakeSubmissionEndpoint {
  readonly commands: string[];
  readonly port: number;
  stop(): Promise<void>;
}

export async function submissionEndpoint(input: {
  readonly offerStartTls: boolean;
}): Promise<FakeSubmissionEndpoint> {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.setEncoding('utf8');
    socket.write('220 fake.velora.test ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      for (const line of chunk.split('\r\n').filter((entry) => entry !== '')) {
        commands.push(line);
        if (line.startsWith('EHLO')) {
          socket.write('250-fake.velora.test\r\n');
          socket.write(
            input.offerStartTls ? '250 STARTTLS\r\n' : '250 SIZE 1000000\r\n',
          );
          continue;
        }
        if (line === 'STARTTLS') {
          // Announced and then refused: the shape a misconfigured relay has,
          // and the one an adapter that "tries" TLS would fall through.
          socket.write(
            input.offerStartTls ? '220 go ahead\r\n' : '502 not supported\r\n',
          );
          continue;
        }
        socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  return {
    commands,
    port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
