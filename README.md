# 前端监控SDK，可用来收集并上报：代码报错、性能数据、页面录屏、用户行为、白屏检测等个性化指标数据

参考[https://github.com/xy-sea/web-see/tree/main] 实现前端性能监控

亮点1：支持多种错误还原方式：定位源码、播放录屏、记录用户行为

亮点2：支持项目的白屏检测，兼容有骨架屏、无骨架屏这两种情况

亮点3：支持错误上报去重，错误生成唯一的id，重复的代码错误只上报一次

亮点4：支持多种上报方式，默认使用web beacon，也支持图片打点、http 上报
