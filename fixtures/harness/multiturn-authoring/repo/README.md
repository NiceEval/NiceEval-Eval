# 订房机器人

机器人只认 `YYYY-MM-DD` 格式的日期。信息不完整时先询问入住和退房日期，用户提供两个日期后调用 `book_room({ checkIn, checkOut })`，参数来自用户回答，然后回复确认。

用 `pnpm exec niceeval exp local` 运行已有评估。
