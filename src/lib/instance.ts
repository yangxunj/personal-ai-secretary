/**
 * 「这是哪个实例」—— 生产（使用者的真数据）还是测试。
 *
 * 由 `.env` 里的 `APP_INSTANCE` 决定，不设就是生产。
 * 两个实例各有自己的目录、自己的 .env、自己的数据库，代码可以不同版本。
 *
 * **这个文件被 middleware（Edge runtime）引用**，所以不能 import 任何
 * Node 内置模块，也不能碰数据库。
 */

/** 测试实例？ */
export const IS_TEST = process.env.APP_INSTANCE === 'test';

/**
 * session cookie 的名字。
 *
 * **必须随实例变。** cookie 不按端口隔离 —— 浏览器把 `https://1.2.3.4:3443`
 * 和 `https://1.2.3.4:3444` 当成同一个源来存 cookie（端口不进 cookie 的
 * 作用域）。两个实例要是共用一个名字，登录测试站就会把生产站那张 cookie
 * 覆盖掉，表现成「登录另一个就被踢下线」；而且两边 SESSION_SECRET 不同，
 * 被覆盖的那张还验不过，用户看到的就是莫名其妙地掉登录。
 */
export const SESSION_COOKIE = IS_TEST ? 'secretary_session_test' : 'secretary_session';
