import axios from 'axios';

export async function sendText(phone: string, text: string) {

    const instanceId = '3E1556F270CC30F46D860293E183E9A4';
    const token = '0BC69137B5B0A58869A55C9C';
    const clientToken = 'F19d4e7a06acd4ef08f0ea9c9473ddd79S'; // Replace with your actual Client-Token

    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

    const data = {
        phone: phone,
        message: text
    };

    const config = {
        headers: {
            'Client-Token': clientToken,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, data, config);
        console.log('Message sent successfully');
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}
