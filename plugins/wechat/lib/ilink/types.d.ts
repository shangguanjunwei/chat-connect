export interface IlinkEnvelope {
    ret?: number;
    errcode?: number;
    errmsg?: string;
    [key: string]: unknown;
}
export interface IlinkItem {
    type?: number;
    text_item?: {
        text?: string;
    };
    [key: string]: unknown;
}
export interface IlinkMessage {
    seq?: number;
    message_id?: string | number;
    client_id?: string;
    from_user_id?: string;
    to_user_id?: string;
    session_id?: string;
    group_id?: string;
    context_token?: string;
    message_type?: number;
    message_state?: number;
    create_time_ms?: number;
    item_list?: IlinkItem[];
    [key: string]: unknown;
}
export interface GetUpdatesResponse extends IlinkEnvelope {
    msgs?: IlinkMessage[];
    get_updates_buf?: string;
}
export interface GetBotQrcodeResponse extends IlinkEnvelope {
    qrcode: string;
    qrcode_img_content: string;
}
export interface GetQrcodeStatusResponse extends IlinkEnvelope {
    status?: string;
    baseurl?: string;
    bot_token?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
}
