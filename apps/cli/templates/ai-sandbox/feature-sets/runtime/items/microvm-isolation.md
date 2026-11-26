---
id: item-microvm-isolation
title: One microVM per sandbox
description: Run every sandbox in its own KVM microVM with a jailer, seccomp filter and no shared filesystem.
outcome: A kernel exploit inside one sandbox cannot read or affect another tenant's sandbox.
status: done
release: rel-private-alpha
start: "2026-05-04"
target: "2026-07"
contributors: [lukas, hana]
contributing_teams: [platform]
jira: [RT-12, RT-14, SEC-2]
---

## What we built

Each sandbox is a Firecracker-style microVM with a minimal device model: virtio-net, virtio-block and a vsock channel for the guest agent. The monitor runs inside a jailer with its own UID, a chroot, a cgroup and a seccomp filter of 41 allowed syscalls.

Guests never share a filesystem with the host or each other. The root disk is a copy-on-write overlay on a read-only template image, exposed as a block device.

## Measured overhead

| Measure | Result |
| --- | --- |
| Monitor memory overhead per sandbox | 5.8 MiB |
| Boot to guest agent ready (no snapshot) | 1.9 s p50 |
| Sandboxes per 64-core host at default size | 96 with 1.5x CPU overcommit |

## Why not containers

A container shares the host kernel. Agent-generated code is untrusted by definition, and a kernel bug would cross tenants. gVisor-style user-space kernels were the alternative; we measured 30% to 60% overhead on `pip install`-heavy workloads, which is most of what agents do.
