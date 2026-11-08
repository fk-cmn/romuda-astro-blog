---
title: "CS144"
description: "check5-7"
pubDate: 2026-11-01
tags: ['计网', 'CS']
heroImage: "./title.png"
updatedDate: 2026-11-08
---

## 写在前面

以下主要是关于checkpoint5-7的笔记，由于时间有限我做的比较浅，探索的地方不多，后续可能还得再花时间读读整个框架代码比较有用，如果有新的东西就再追加过来，看看还有什么坑可以挖（）

所以下面的内容目前更偏向于是对几个核心过程的逻辑梳理和一些总结。

## 简述

Checkpoint 5 和 Checkpoint 6 处理的是网络栈中的**网络接口和路由层**，位于TCP 之下，负责把 IP 数据报从一台主机送到下一跳，并在路由器上决定数据接下来该往哪里传输。

先回顾一下之前的check:

```text
应用层：webget（Checkpoint 0，Checkpoint 4 使用自实现 TCP）
    │   构造 HTTP 请求、输出响应
    ↓
传输层：TCP（Checkpoint 1–3）
    │   Reassembler、TCPReceiver、TCPSender
    │   处理字节重组、序号、ACK、流量控制与重传
    ↓
网络层：IPv4 / Router（Checkpoint 6）
    │   根据目的 IP 做最长前缀匹配
    │   检查 TTL，选择出口接口和下一跳
    ↓
链路层：Ethernet / NetworkInterface（Checkpoint 5）
    │   通过 ARP 获取下一跳 MAC
    │   封装、发送和接收以太网帧
    ↓
输出端口与底层传输设施
        将帧交给实际链路或实验中的模拟链路
```

上面的思维导图是说明各层负责的内容，接下来是同一份应用数据如何逐层封装：

<u>TCP 添加自己的首部，形成 TCP 报文段；IPv4 将报文段作为载荷，组成 IP 数据报；网络接口再把数据报装入以太网帧。</u>

```text
应用数据：GET / HTTP/1.1 ...
          ↓ TCP 加头
TCP 报文段：[TCP头 | 应用数据]
          ↓ IPv4 加头
IP 数据报：[IP头 | TCP头 | 应用数据]
          ↓ 以太网加头
以太网帧：[以太网头 | IP头 | TCP头 | 应用数据]
```

每层的 **payload**，就是这一层头部后面装的内容，因此上述的对象都有叫payload的字段，承载的意义不同。

## checkpoint 5

这里是要实现Network Interface的功能：封装和解析 IPv4 数据报，利用 ARP 消息类型实现地址解析所需的请求、回复等机制。总体上，解决的问题是：

`如何把 IPv4 数据报交给当前链路上的下一跳，以及怎么接收并解析链路上的帧？`

### 涉及的名词

| 名词                  | 含义                                                         | 作用                              |
| --------------------- | ------------------------------------------------------------ | --------------------------------- |
| IPv4 数据报           | 网络层的数据单元，包含源 IP、目的 IP 等首部信息              | 被网络接口封装进以太网帧          |
| 以太网帧              | 链路层的数据单元，包含源 MAC、目的 MAC 和类型字段            | 在当前链路上传送数据报或 ARP 消息 |
| IP 地址               | IPv4 层使用的地址                                            | 标识最终目的地，也用于表示下一跳  |
| MAC 地址              | 以太网使用的链路地址                                         | 标识当前链路上的帧接收者          |
| 下一跳                | 当前要把数据交给的邻居，可能是目的主机，也可能是路由器       | 用它的 IP 查找对应 MAC            |
| ARP                   | 查询 IPv4 地址对应 MAC 地址的协议                            | 缓存未命中时询问下一跳的 MAC      |
| `arp_cache_`          | 下一跳 IP 到 MAC 映射的缓存                                  | 命中时可直接封装并发送帧          |
| `pending_datagrams_`  | 等待下一跳 MAC 的数据报队列                                  | ARP 尚未得到回复时暂存待发数据    |
| `datagrams_received_` | 从 IPv4 以太网帧中解析出的数据报队列                         | 等待上层或路由器取走              |
| 载荷                  | 某一层的数据单位中，除去这一层首部等控制信息后，实际承载的内容 |                                   |

### 以太网帧 frame

可以看作是Ethernet的数据单位：

```cpp
struct EthernetFrame
{
  EthernetHeader header {};
  std::vector<Ref<std::string>> payload {};
  void parse( Parser& parser )
  {
    header.parse( parser );
    parser.all_remaining( payload );
  }
  void serialize( Serializer& serializer ) const
  {
    header.serialize( serializer );
    serializer.buffer( payload );
  }
};
```

qvq可能这样看的更清楚：

```text
EthernetFrame
├── header：EthernetHeader
│   ├── dst：目的 MAC
│   ├── src：源 MAC
│   └── type：载荷协议类型
│
└── payload：按协议格式编码的字节
    ├── type 为 IPv4 → IPv4 数据报
    └── type 为 ARP  → ARP 消息
```

序列化处理的辅助函数：

`序列化：按照协议规定的字段顺序和字节序生成字节，“协议”取决于正在序列化哪个对象。`

1.`serialize()`：把对象编码成协议字节

2.`parse()`：把协议字节解析成对象

具体协议格式：

| 协议格式        | 主要字段（按编码顺序）                                       |
| --------------- | ------------------------------------------------------------ |
| **以太网帧**    | 目的 MAC（6 字节）→ 源 MAC（6 字节）→ 类型（2 字节）→ 载荷   |
| **ARP 消息**    | 硬件类型、协议类型、地址长度 → 操作类型 → 发送方 MAC/IP → 目标 MAC/IP |
| **IPv4 数据报** | 版本、首部长度、服务字段、总长度 → 标识与分片字段 → TTL、协议、首部校验和 → 源 IP、目的 IP → 可选项 → 载荷 |

了解上述内容后，`NetworkInterface` 的核心任务就是下面的三个函数：

> `send_datagram()` 将 IPv4 数据报封装发送
>
> `recv_frame()` 解析收到的帧并处理 ARP
>
> `tick()` 管理地址映射和请求的有效期

### send_datagram()

send_datagram() 接收的参数是 IPv4 数据报和下一跳地址，根据已给定的下一跳 IP，找到对应 MAC，并完成以太网封装。

首先我们要查询ARP 缓存，看是否有下一跳地址作为缓存的键，注意这里不能查`dgram` 的最终目的 IP，因为当目的主机位于远端网络时，当前帧要先交给下一跳路由器。若命中，打包发送即可；若未命中，则存入pending_datagrams_，判断是否需要重复请求，并限制请求频率。

```cpp
void NetworkInterface::send_datagram( const InternetDatagram& dgram, const Address& next_hop )
{
  const uint32_t next_ip = next_hop.ipv4_numeric();
  const auto it = arp_cache_.find(next_ip);
    //缓存命中
  if (it != arp_cache_.end()) {
    EthernetFrame frame;
    frame.header.src =  ethernet_address_;
    frame.header.dst =  it->second.mac;
    frame.header.type = EthernetHeader::TYPE_IPv4;
    frame.payload = serialize(dgram);
    transmit(frame);
    return;
  }
    //未命中
    pending_datagrams_[next_ip].push(dgram);
    const auto request = arp_request_age_ms_.find(next_ip);
  if (request != arp_request_age_ms_.end() && request->second < 5000) {
    return; // 5 秒内请求过，只排队不重复广播
  }
  // 这里构造,发送 ARP 请求 -> util/arp_message.hh
  ARPMessage arp;
    arp.opcode = ARPMessage::OPCODE_REQUEST;
    arp.sender_ethernet_address = ethernet_address_;
    arp.sender_ip_address = ip_address_.ipv4_numeric();
    arp.target_ip_address = next_ip;

  EthernetFrame arp_frame;
    arp_frame.header.src =  ethernet_address_;
    arp_frame.header.dst =  ETHERNET_BROADCAST;
    arp_frame.header.type = EthernetHeader::TYPE_ARP;
    arp_frame.payload = serialize(arp);
    transmit(arp_frame);
  // ARP 请求交给输出端口后，开始计时
  arp_request_age_ms_[next_ip] = 0;

}
```

#### 广播发给谁？

是**当前接口 (正在发送这个广播帧的网络接口) 所连接的以太网广播域内的接口**。

好了那以太网广播域又是怎样的范围？~~（问题也是子子孙孙无穷匮也~~

一个以太网广播帧能够通过二层转发到达的范围，但这个要以网络连接方式和配置决定，与物理距离或 IP 地址是否相似无关。同一广播域可以跨越多台交换机；一台交换机也可以通过 VLAN（虚拟局域网）划分出多个广播域。不同 VLAN 之间的通信通常需要路由功能，而普通 ARP 广播不会被路由转发到另一广播域。

### recv_frame()

`recv_frame()` 接收一个以太网帧。整体的思路是先过滤出目的MAC，然后根据头部的 `type` 分流：IPv4 帧 or ARP 帧。

1.IPv4 帧：

   尝试把帧的 payload 解析成 `InternetDatagram`，成功后放入 `datagrams_received_`，失败则丢弃。并且处理完 IPv4 分支后都返回，避免再按 ARP 处理同一帧。

```cpp
//IPv4
  if (frame.header.type == EthernetHeader::TYPE_IPv4) {
  InternetDatagram dgram;
  if (parse(dgram, frame.payload)) {
    datagrams_received_.push(std::move(dgram));
  }
  return;
}
```

2.ARP 帧：

  在解析消息后，检查它是否是本实现支持的 ARP 格式，然后接口更新 `arp_cache_`，记录“发送方 IP 对应这个 MAC”。接着查看是否有数据报正等待这个发送方的 MAC，有就就把每个数据报序列化为 IPv4 以太网帧来发送。最后，检查这是否是发给本接口 IP 的 ARP 请求，如果是的话就构造 ARP通过frame回复。

```
//ARP
  if(frame.header.type == EthernetHeader::TYPE_ARP){
    ARPMessage arp;
    if(!parse(arp,frame.payload)){ //格式错误or解析失败
      return;
    }
    if(!arp.supported()){
      return;
    }
    const uint32_t sender_ip = arp.sender_ip_address;
    arp_cache_[sender_ip] = ARPEntry{arp.sender_ethernet_address, 0};

    const auto pend = pending_datagrams_.find(sender_ip);
    if(pend!=pending_datagrams_.end()){
     auto& queue = (pend->second);
     while(!queue.empty()){
        InternetDatagram dgram = queue.front();
        //out_frame:要发送的帧
        EthernetFrame out_frame;
        out_frame.header.src = ethernet_address_;
        out_frame.header.dst =  arp.sender_ethernet_address;
        out_frame.header.type = EthernetHeader::TYPE_IPv4;
        out_frame.payload = serialize(dgram);
        transmit(out_frame);
        queue.pop();
     }
     pending_datagrams_.erase(pend);
    }

    if (arp.opcode == ARPMessage::OPCODE_REQUEST
    && arp.target_ip_address == ip_address_.ipv4_numeric()) {
  // 构造 ARP 回复，装进以太网帧发送
      ARPMessage reply;
        reply.opcode = 	ARPMessage::OPCODE_REPLY;
        reply.sender_ethernet_address = ethernet_address_;
        reply.sender_ip_address = ip_address_.ipv4_numeric();
        reply.target_ethernet_address = arp.sender_ethernet_address;
        reply.target_ip_address = sender_ip;
      EthernetFrame reply_frame;
        reply_frame.header.src = ethernet_address_;
        reply_frame.header.dst = arp.sender_ethernet_address;
        reply_frame.header.type = EthernetHeader::TYPE_ARP;
        reply_frame.payload = serialize(reply);
        transmit(reply_frame);
    }
  return;
  }
```

> 总体上就是：
>
>    目的 MAC 过滤
>        → 按 Ethernet type 分流
>       IPv4：解析 → 入队供上层读取
>       ARP：解析和校验 → 学习 IP/MAC
>             → 发送等待中的 IPv4 数据报
>             → 若请求的是本接口 IP，则回复 ARP

### tick()：计时与过期清理

维护以下规则：

1.未完成的 ARP 请求 arp_request_age_ms_等待达 5 秒后，删除请求记录及对应的待发数据报，因此后面`send_datagram()` 再遇到缓存未命中，就可以重新发起新的 ARP 请求。

```c++
 for (auto it = arp_request_age_ms_.begin(); it != arp_request_age_ms_.end();) {
    if (it->second >= 5000 || ms_since_last_tick >= 5000 - it->second) {
      pending_datagrams_.erase(it->first);
      it = arp_request_age_ms_.erase(it);
    } else {
      it->second += ms_since_last_tick;
      ++it;
   }
  }
```

2.已学到的 ARP 映射缓存时间达 30 秒后删除，未到期的条目则累加本次经过的毫秒数。

```c++
for (auto it = arp_cache_.begin(); it != arp_cache_.end();) {
    if(it->second.age_ms >= 30000 || ms_since_last_tick >= 30000 - it->second.age_ms){
      it = arp_cache_.erase(it);
    }else {
      it->second.age_ms += ms_since_last_tick;
      ++it;
   }
  }
```

## checkpoint 6

Checkpoint 5 实现了网络接口收发功能，比如发送的时候，调用者需要先选择一个接口，并提供 IPv4 数据报和下一跳 IP。接口再查询 ARP 缓存，必要时发送 ARP 请求，获得下一跳 MAC 后封装以太网帧发送。

但这取决于一个前提：**应该选择哪个接口，下一跳 IP 又是什么？**

Checkpoint 6实现的路由器，解决的问题就是上面的决策。 路由器根据数据报的最终目的 IP 查询路由表，选择出口接口和下一跳，再调用 Checkpoint 5 的网络接口完成发送。

### 涉及到的名词

| 名词                           | 含义                                               | 作用                                               |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| Router（路由器）               | 根据 IPv4 目的地址选择转发路径的组件               | 从入口接口取出数据报，查找路由，再交给出口接口     |
| 路由表（routing table）        | 一组目的地址前缀及其转发规则                       | 决定数据报从哪个接口发出，以及应交给哪个下一跳     |
| 路由条目（route entry）        | 一条路由规则，包含前缀、前缀长度、下一跳和接口索引 | 描述某类目的地址应该如何转发                       |
| `route_prefix`                 | 路由条目的 IPv4 网络前缀，以 `uint32_t` 保存       | 与数据报目的 IP 的高位比较，判断是否匹配           |
| `prefix_length`                | 前缀长度，范围为 0 到 32                           | 指定比较 IPv4 地址的前多少位；也用于选择最长匹配   |
| CIDR 前缀                      | 形如 `192.168.1.0/24` 的网络表示法                 | `/24` 表示前 24 位是网络部分，剩余位可不同         |
| 最长前缀匹配                   | 多条路由都匹配时，选择 `prefix_length` 最大的一条  | 优先使用范围最具体的转发规则                       |
| 默认路由 `/0`                  | 前缀长度为 0 的路由，匹配所有目的 IP               | 作为其他路由都不匹配时的转发选择                   |
| `interface_num`                | Router 中出口接口在 `interfaces_` 向量里的索引     | 找到应调用哪个 `NetworkInterface` 发送数据报       |
| TTL（Time To Live）            | IPv4 首部中的剩余转发跳数                          | 每经过一个路由器减 1；TTL 不足时丢弃，避免路由环路 |
| IPv4 首部校验和                | 根据 IPv4 首部内容计算出的校验值                   | TTL 等首部字段修改后必须重新计算                   |
| 入口接口（incoming interface） | 收到当前数据报的网络接口                           | Router 从它的接收队列中取出数据报                  |
| 出口接口（egress interface）   | 路由选出的发送接口                                 | 调用它的 `send_datagram()` 继续转发                |
| 直连路由（direct route）       | 不指定 `next_hop` 的路由                           | 表示目的网络直接连接到出口接口，下一跳就是目的主机 |
|                                |                                                    |                                                    |

### IPv4 地址与网络前缀

IPv4 地址用于网络层寻址，通常配置在网络接口上。据报首部中的**源 IP**表示发送方地址，**目的 IP**表示最终要到达的地址，路由器会根据目的 IP 选择转发方向。

 它总共有**32 个二进制位**，通常分成四组，每组 8 位，转换成十进制后用点连接，每组取值为 `0～255`：

> 十进制：192.168.1.123
> 二进制：11000000  10101000  00000001  01111011

如果要用一条路由描述一个地址范围，我们需要指定前缀长度，比如，192.168.1.0/24，这里的**`/24` 表示前 24 位固定，后 8 位可以变化**，所以路由的匹配范围是192.168.1.0～192.168.1.255。另外，前缀长度按二进制位计算，不一定以点分组为边界。

### 路由器要保存哪些信息？

大致是两类信息：已经连接的网络接口，以及决定如何使用这些接口的转发规则，这样才方便后续进行匹配转发的时候去查表。

这个保存提前创建好的接口对象在原框架的代码里已经有所包含，我们通过`interface(N)`取得已有接口：

```cpp
std::vector<std::shared_ptr<NetworkInterface>> interfaces_ {};
```

知道有这些接口后，我们就要思考如何实现它的导航功能了，也就是“发往某个目的地址的数据报应该走哪个接口”，这就要求需要额外保存**匹配条件和转发动作之间的规则**。

所以我在这里创建了一个RouteEntry结构体，将一条转发规则分成匹配条件和转发动作。`route_prefix` 和 `prefix_length` 描述**适用的目的地址范围**；`next_hop` 和 `interface_num` 描述**匹配后从哪里发出、要交给谁**，所有的条目存于routes_。

```cpp
struct RouteEntry
{
  uint32_t route_prefix {};
  uint8_t prefix_length {};
  std::optional<Address> next_hop {};
  size_t interface_num {};
};

std::vector<RouteEntry> routes_ {};
```

> // route_prefix：用于与数据报目的地址进行匹配的 IPv4 地址前缀，
> // 最多使用其中的 32 位。
>
> // prefix_length：这条路由适用时，route_prefix 的多少个高位
> //（最高有效位）必须与数据报目的地址的对应位相同？
>
> // next_hop：下一跳的 IP 地址。
> // 如果目的网络直接连接在本路由器上，这个值为空；
> // 此时应将数据报的最终目的地址用作下一跳地址。
>
> // interface_num：发送该数据报所使用的出口接口下标。

当收到数据报后，路由器读取其 IPv4 首部中的目的地址，开始遍历路由表。匹配规则要求**前缀规定的高位相同**。如果多条规则都匹配，则选择前缀最长、目的范围最具体的规则，再交给对应接口完成下一跳发送。

### 如何增添和执行上述的规则

这里关注add_route()和route()这2个函数。

前面我们提到的route_prefix来自于先前添加的路由规则，然后路由器用数据报的“目的 IPv4 地址”与它比较。这里，add_route()就是负责配置规则的部分，route()则用于处理拿到的数据报，读取其目的 IP，与前保存的规则逐条匹配。

```cpp
//提供目的地址前缀、前缀长度、下一跳和出口接口
void Router::add_route( const uint32_t route_prefix,
                        const uint8_t prefix_length,
                        const optional<Address> next_hop,
                        const size_t interface_num )
{
  cerr << "DEBUG: adding route " << Address::from_ipv4_numeric( route_prefix ).ip() << "/"
       << static_cast<int>( prefix_length ) << " => " << ( next_hop.has_value() ? next_hop->ip() : "(direct)" )
       << " on interface " << interface_num << "\n";

  routes_.push_back(
    RouteEntry { route_prefix, prefix_length, next_hop, interface_num });

}
```

#### **Route(): 根据路由表处理收到的数据报**

整个过程就是：**取出数据报、检查 TTL、查找最长前缀匹配、更新首部并转发。**

1.Checkpoint 5 的接口收到 IPv4 帧后，会将解析成功的数据报放进 `datagrams_received_`，这时就由路由器遍历所有接口，逐个取出队列中的数据报。

```cpp
for (const auto& incoming : interfaces_) {
  auto& queue = incoming->datagrams_received();

  while (!queue.empty()) {
    InternetDatagram dgram = std::move(queue.front());
    queue.pop();

    if (dgram.header.ttl <= 1) {
       continue;
     }
    //...
  }
}
```

2.TTL 用于限制数据报的转发生命，防止它因路由环路而无限传播。在我的函数里，每转发一次就减一，收到TTL时若为 `0` 或 `1`，就直接丢弃。

3.关于查找匹配且前缀最长的规则

```cpp
const RouteEntry* best = nullptr;

for (const auto& route : routes_) {
  const bool matches =
    route.prefix_length == 0
    || (dgram.header.dst >> (32 - route.prefix_length))
         == (route.route_prefix >> (32 - route.prefix_length));

  if (matches
      && (best == nullptr
          || route.prefix_length > best->prefix_length)) {
    best = &route;
  }
}
//对于新的数据报，重新初始化 best
if (best == nullptr) {
  continue;
}
```

`best` 保存当前找到的最佳条目，若多条规则都匹配，就选择 `prefix_length` 最大的一条（更具体）。

对每条路由，将目的 IP 和路由前缀都右移 `32 - prefix_length` 位，保留需要比较的高位。

注意/0是要单独判断的，它表示匹配所有地址，避免执行右移 32 位的操作。

4.确定可以转发后，将 TTL 减一，然后确定下一跳 IP。`value_or()` 表示：如果条目指定了下一跳，就使用它；如果为空，说明是直连路由，使用数据报的最终目的 IP 作为下一跳。随后，取得已有的出口接口调用发送函数，继续执行check5的操作。

```c++
--dgram.header.ttl;
dgram.header.compute_checksum();
const Address next_hop =
  best->next_hop.value_or(
    Address::from_ipv4_numeric(dgram.header.dst));
interface(best->interface_num)->send_datagram(dgram, next_hop);
```

> IPv4 首部
> ├── 源 IP、目的 IP
> ├── TTL
> ├── 其他字段
> └── 首部校验和：根据首部内容计算
>
> IPv4 首部校验和用于检测首部差错。TTL 是首部的一部分，路由器将其减一后，必须同步更新校验和，否则下一跳可能判定首部校验失败。该校验和只覆盖 IPv4 首部，不包含 payload。

## checkpoint 7

一个端到端的验证性check，和check4一样，不用写代码，主要是把前面已完成的 TCP、NetworkInterface 和 Router 组合起来，看看能不能正确传输文件。

这个讲义的中继cs144.keithw.org我好像用不了emmm，抓包观察到发出的 UDP 注册消息和承载 ARP 帧的 UDP 数据报，但未观察到中继返回，目前不确定原因。~~（后面再看看咋了~~

然后，我就尝试用**本机 UDP 中继**转发两个程序之间的以太网帧。本机中继只转发字节，ARP 解析、IPv4 路由和 TCP 可靠传输仍由项目代码完成，最后结果是可以成功进行双向文字通信，以及能够完成一个 1 MiB 随机文件的传输...万幸。

贴个结果先：

```text
romuda@LAPTOP-G8SUAS7V:~/workspace/cs144/minnow-2025$ dd if=/dev/urandom of=/tmp/cs144-send.bin bs=1M count=1
./build/apps/endtoend server 127.0.0.1 15504 < /tmp/cs144-send.bin
1+0 records in
1+0 records out
1048576 bytes (1.0 MB, 1.0 MiB) copied, 0.00455772 s, 230 MB/s
DEBUG: Network interface has Ethernet address 02:00:00:17:ca:c6 and IP address 172.16.0.1
DEBUG: Network interface has Ethernet address 02:00:00:97:77:c6 and IP address 10.0.0.172
DEBUG: adding route 172.16.0.0/12 => (direct) on interface 0
DEBUG: adding route 10.0.0.0/8 => (direct) on interface 1
DEBUG: adding route 192.168.0.0/16 => 10.0.0.192 on interface 1
DEBUG: Network interface has Ethernet address 2e:dc:f0:c1:f5:36 and IP address 172.16.0.100
DEBUG: minnow listening for incoming connection...
DEBUG: minnow new connection from 192.168.0.50:8667.
DEBUG: minnow inbound stream from 192.168.0.50:8667 finished cleanly.
DEBUG: Inbound stream from 172.16.0.100 finished.
DEBUG: Outbound stream to 172.16.0.100 finished.
DEBUG: minnow waiting for clean shutdown... DEBUG: minnow outbound stream to 192.168.0.50:8667 finished (52000 seqnos still in flight).
DEBUG: minnow outbound stream to 192.168.0.50:8667 has been fully acknowledged.
DEBUG: minnow TCP connection finished cleanly.
done.
Exiting... done.
```

```text
romuda@LAPTOP-G8SUAS7V:~/workspace/cs144/minnow-2025$ ./build/apps/endtoend client 127.0.0.1 15505 \
  < /dev/null > /tmp/cs144-received.bin
DEBUG: Network interface has Ethernet address 02:00:00:8d:55:32 and IP address 192.168.0.1
DEBUG: Network interface has Ethernet address 02:00:00:23:6c:5b and IP address 10.0.0.192
DEBUG: adding route 192.168.0.0/16 => (direct) on interface 0
DEBUG: adding route 10.0.0.0/8 => (direct) on interface 1
DEBUG: adding route 172.16.0.0/12 => 10.0.0.172 on interface 1
DEBUG: Network interface has Ethernet address 4a:db:44:6b:8c:82 and IP address 192.168.0.50
DEBUG: Connecting from 192.168.0.50:8667...
DEBUG: minnow connecting to 172.16.0.100:1234...
DEBUG: minnow successfully connected to 172.16.0.100:1234.
DEBUG: Outbound stream to 172.16.0.100 finished.
DEBUG: minnow outbound stream to 172.16.0.100:1234 finished (0 seqnos still in flight).
DEBUG: minnow outbound stream to 172.16.0.100:1234 has been fully acknowledged.
DEBUG: minnow inbound stream from 172.16.0.100:1234 finished cleanly.
DEBUG: Inbound stream from 172.16.0.100 finished.
DEBUG: minnow waiting for clean shutdown... DEBUG: minnow TCP connection finished cleanly.
done.
Exiting... done.
romuda@LAPTOP-G8SUAS7V:~/workspace/cs144/minnow-2025$ wc -c /tmp/cs144-send.bin /tmp/cs144-received.bin
sha256sum /tmp/cs144-send.bin /tmp/cs144-received.bin
1048576 /tmp/cs144-send.bin
1048576 /tmp/cs144-received.bin
2097152 total
f18481a3c18e6e68bc8e945e6119f2a0d64053cfc76afb05f1fd745ed99a648e  /tmp/cs144-send.bin
f18481a3c18e6e68bc8e945e6119f2a0d64053cfc76afb05f1fd745ed99a648e  /tmp/cs144-received.bin
```
