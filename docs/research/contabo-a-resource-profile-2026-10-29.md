# Contabo A resource profile

Observed on 2026-10-29 at 13:19-13:21 UTC, using explicitly authorized read-only SSH inspection of `contabo` and one authenticated Coolify application GET. No application requests, database queries, benchmarks, deployments, restarts, configuration changes or remote file writes were issued. This note is saved locally.

## Host

| Resource | Observation |
| --- | --- |
| CPU | 6 virtual CPUs, x86_64, AMD EPYC Processor with IBPB. Full virtualization. Physical core allocation and contention are not established. |
| RAM | 12,541,476,864 bytes, approximately 11.68 GiB. |
| Memory available | 8,977,973,248 bytes, approximately 8.36 GiB at the observation instant. This is not reserved application capacity. |
| Swap | Approximately 4 GiB total, 1.04 GiB occupied. A one-second vmstat interval showed no swap-in or swap-out. Occupied swap alone does not establish current memory pressure. |
| Disk | 214,748,364,800 bytes, 200 GiB, QEMU HARDDISK, ROTA=0. The guest reports non-rotational storage but does not identify the physical SSD/NVMe backing or its throughput. |
| Filesystem | ext4 on /dev/sda1, shared by root and Docker. 90,471,432,192 bytes available, approximately 84.26 GiB, at observation. |
| Shared workload | 20 running Docker containers, including Coolify, other applications and databases. There may also be host processes. |
| Load average | 2.11, 2.78, 2.51 at the first observation. A later one-second sample was 98% CPU idle. Neither is a workload capacity benchmark. |

## DomainVoter

Coolify application UUID `isawmwwcmnfj28hyo3irrvt0`, name `domainvoter`, status `running:healthy`. The running image references commit `8b3712971cd8453518ae9fb0df4ed486c1aae2d2`, not the local preview integration.

| Setting | Coolify and runtime observation |
| --- | --- |
| CPU cap | None. Coolify limits_cpus=0; Docker NanoCpus/CpuQuota/CpuPeriod=0; cgroup cpu.max=max 100000. |
| CPU shares | 1024. This is relative scheduling weight, not a dedicated CPU reservation. |
| CPU affinity | Unset. |
| Memory cap/reservation | None. Coolify and Docker values are zero; cgroup memory.max and memory.high are max. |
| Swap-specific cap | No container-specific cap observed; cgroup memory.swap.max=max. Host swap remains finite. |
| Disk I/O cap | No device BPS/IOPS limits observed; cgroup io.max is empty. |
| PID cap | Unset. |
| Parent limits | system.slice also has cpu.max, memory.max, memory.high and memory.swap.max set to max, with empty io.max. |
| Current usage snapshot | CPU 0.05%, Docker-reported memory 193.5 MiB, 13 PIDs. Idle snapshot only, not peak creation memory. |
| Data storage | Docker volume mounted read/write at /app/data on the shared host disk. The mount was inspected without reading the database. |

## Consequence for local comparisons

The host specifications are now known, but DomainVoter has no configured exclusive resource budget. Do not give a local candidate all six CPUs and all host memory and call that representative of its shared deployment.

Use candidate local envelopes of 1 vCPU / 1 GiB and 2 vCPU / 2 GiB when comparing implementations. These are proposed comparison budgets, not changes to Coolify or proof that capacity is reserved. Keep one creation job, bounded read concurrency and bounded temporary data in each case. Budget an added PostgreSQL/search service together with the application, rather than giving each the full allowance. An actual server storage latency model remains unknown, so CPU/RAM caps alone cannot validate server timings.

Checks used: `lscpu`, `free -b`, `lsblk`, `df`, `uptime`, `docker ps`, `docker stats --no-stream`, specifically filtered `docker inspect`, cgroup/pressure files, `findmnt`, `vmstat 1 2`, and GET `/api/v1/applications/<uuid>` with only status and resource fields printed. Credentials and environment values were not printed. The initial shell inspection ended with a syntax error in its final pressure-reading loop; a subsequent Python inspection successfully collected pressure, runtime limits and Coolify settings.
