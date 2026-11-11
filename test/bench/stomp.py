"""Minimal STOMP 1.2 client over a raw WebSocket (same idea as test/trading_integrity.py).

Used by the benchmark and the 1.0.0 test scripts. One background thread reads frames and
hands MESSAGE frames to a callback (or a queue).
"""
import json
import queue
import threading
import time

import websocket

NUL = "\x00"


class Stomp:
    def __init__(self, ws_url, token=None, on_message=None, timeout=10):
        self.ws = websocket.create_connection(ws_url, timeout=timeout)
        self.on_message = on_message
        self.inbox = queue.Queue()
        self.buffer = []
        self.alive = True
        self.disconnected = False
        self._subs = 0
        headers = {"accept-version": "1.2", "heart-beat": "0,0"}
        if token:
            headers["Authorization"] = "Bearer " + token
        self._send_frame("CONNECT", headers)
        frame = self._read_frame()
        if not frame or frame["command"] != "CONNECTED":
            raise ConnectionError("STOMP CONNECT failed: %r" % (frame,))
        self.ws.settimeout(None)
        threading.Thread(target=self._reader, daemon=True).start()

    def _send_frame(self, command, headers, body=""):
        head = "\n".join([command] + ["%s:%s" % (k, v) for k, v in headers.items()])
        self.ws.send(head + "\n\n" + body + NUL)

    def _read_frame(self):
        raw = self.ws.recv()
        if not raw or raw.strip() == "":
            return None
        raw = raw.rstrip(NUL)
        head, _, body = raw.partition("\n\n")
        lines = head.split("\n")
        headers = dict(line.split(":", 1) for line in lines[1:] if ":" in line)
        return {"command": lines[0], "headers": headers, "body": body}

    def _reader(self):
        while self.alive:
            try:
                frame = self._read_frame()
            except Exception:
                if self.alive:
                    self.disconnected = True
                break
            if not frame or frame["command"] != "MESSAGE":
                continue
            received = time.time()
            try:
                body = json.loads(frame["body"] or "null")
            except ValueError:
                body = frame["body"]
            dest = frame["headers"].get("destination")
            if self.on_message:
                self.on_message(dest, body, received)
            else:
                self.inbox.put({"dest": dest, "body": body})

    def subscribe(self, dest):
        self._subs += 1
        self._send_frame("SUBSCRIBE", {"id": "sub-%d" % self._subs, "destination": dest, "ack": "auto"})

    def send(self, dest, body):
        self._send_frame("SEND", {"destination": dest, "content-type": "application/json"},
                         json.dumps(body, default=str))

    def wait(self, pred, timeout=8.0):
        """Return the first buffered or incoming message body matching pred(dest, body)."""
        for m in list(self.buffer):
            if pred(m["dest"], m["body"]):
                self.buffer.remove(m)
                return m["body"]
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                m = self.inbox.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                break
            if pred(m["dest"], m["body"]):
                return m["body"]
            self.buffer.append(m)
        return None

    def close(self):
        self.alive = False
        try:
            self.ws.close()
        except Exception:
            pass
