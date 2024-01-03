import { Backtest, IBacktestPositions } from '../../src/Common/Backtest';

import { RSI } from '../../components/indicator/RSI';
import { MA } from '../../components/indicator/MA';
import { Common } from '../../src/Common/Common';

import { Log } from '../../components/log';
import { MoneyValue, Quotation } from 'tinkoff-sdk-grpc-js/dist/generated/common';
import { HistoricCandle } from 'tinkoff-sdk-grpc-js/dist/generated/marketdata';

export class Robot {
    tradeSystem: Backtest;
    logSystem: Log;

    candles: HistoricCandle[] = [];
    currentCandle?: HistoricCandle = undefined;
    currentPriceMoneyValue: MoneyValue | Quotation | undefined = { units: 0, nano: 0, currency: '' };
    currentPrice: number = 0;
    priceToClosePosition: number = 0;
    PRICE_DIFF: number = 2;
    MONEY_LIMIT: number = 100000;

    RSI: number = 0;
    PERIOD_RSI: number = 30;

    MA: number = 0;
    PERIOD_MA: number = 200;

    constructor(tradeSystem: Backtest, logSystem: Log) {
        this.tradeSystem = tradeSystem;
        this.logSystem = logSystem;
        this.logSystem.refresh();
    }

    async initStep(currentCandle: HistoricCandle) {
        if (!currentCandle) {
            return;
        }

        this.candles.push(currentCandle);
        this.currentCandle = currentCandle;
        this.currentPriceMoneyValue = currentCandle.close;
        this.currentPrice = Common.getPrice(currentCandle.close) || 0;

        if (this.candles.length > this.PERIOD_RSI && this.candles.length > this.PERIOD_MA) {
            this.RSI = await RSI.calculate(this.candles.slice(-this.PERIOD_RSI - 1), this.PERIOD_RSI) || 0;
            this.MA = await MA.calculate(this.candles.slice(-this.PERIOD_MA - 1), this.PERIOD_MA, 'MA') || 0;
        }
    }

    makeStep() {
        if (this.needBuy()) {
            this.makeBuy();
        } else if (this.needSell()) {
            this.makeSell();
        } else if (this.needCloseBuy() || this.needCloseSell()) {
            let lots = 0;

            this.tradeSystem.getOpenedPositions().forEach(position => lots += position.lots);
            this.tradeSystem.backtestClosePosition(this.currentPriceMoneyValue);
            this.consolePositionMessage(this.tradeSystem.getLastPosition());
        }
    }

    calcSumPriceAndLots(positions: IBacktestPositions[]) {
        const defaultVals = {
            lots: 0,
            sumPrice: 0,
        };

        return positions?.reduce<{
            lots: number;
            sumPrice: number;
        }>((acc, position) => {
            const price = Common.getPrice(position.price);

            if (typeof price === 'undefined') {
                return acc;
            }

            acc.sumPrice += price * position.lots;
            acc.lots += position.lots;

            return acc;
        }, defaultVals) || defaultVals;
    }

    makeBuy() {
        if (!this.currentCandle?.time) {
            throw 'Нет времени в this.currentCandle?.time';
        }

        if (!this.tradeSystem.hasBacktestOpenPositions()) {
            this.priceToClosePosition = (this.currentPrice + this.MA) / 2;
        } else {
            const { lots, sumPrice } = this.calcSumPriceAndLots(this.tradeSystem.getOpenedPositions());
            const avgPrice = sumPrice / lots;

            this.priceToClosePosition = (avgPrice + this.MA) / 2;
        }

        this.tradeSystem.backtestBuy(
            this.currentPriceMoneyValue,
            this.calcLots(this.currentPrice, this.MONEY_LIMIT),
            this.currentCandle?.time,
        );
        this.consolePositionMessage(this.tradeSystem.getLastOpenedPosition());
    }

    makeSell() {
        if (!this.currentCandle?.time) {
            throw 'Нет времени в this.currentCandle?.time';
        }

        if (!this.tradeSystem.hasBacktestOpenPositions()) {
            this.priceToClosePosition = (this.currentPrice + this.MA) / 2;
        } else {
            const { lots, sumPrice } = this.calcSumPriceAndLots(this.tradeSystem.getOpenedPositions());

            const avgPrice = sumPrice / lots;

            this.priceToClosePosition = (avgPrice + this.MA) / 2;
        }

        this.tradeSystem.backtestSell(
            this.currentPriceMoneyValue,
            this.calcLots(this.currentPrice, this.MONEY_LIMIT),
            this.currentCandle?.time,
        );
        this.consolePositionMessage(this.tradeSystem.getLastOpenedPosition());
    }

    needBuy() {
        const hasOpenedPosition = this.tradeSystem.hasBacktestOpenPositions();
        const hasPriceDiff = this.calcPercentDiff(this.currentPrice, this.MA) < -this.PRICE_DIFF;
        const hasLowRSI = this.RSI < 30;
        const price = Common.getPrice(this.tradeSystem.getLastOpenedPosition()?.price);

        return hasPriceDiff && hasLowRSI && typeof price !== 'undefined' && (
            !hasOpenedPosition ||
            (
                this.hasTimeDiff(30) &&
                this.calcPercentDiff(
                    this.currentPrice,
                    price,
                ) < -this.PRICE_DIFF
            )
        );
    }

    needSell() {
        const hasOpenedPosition = this.tradeSystem.hasBacktestOpenPositions();
        const hasPriceDiff = this.calcPercentDiff(this.currentPrice, this.MA) > this.PRICE_DIFF;
        const hasHighRSI = this.RSI > 70;
        const price = Common.getPrice(this.tradeSystem.getLastOpenedPosition()?.price);

        return hasPriceDiff && hasHighRSI && typeof price !== 'undefined' && (
            !hasOpenedPosition ||
            (
                this.hasTimeDiff(30) &&
                this.calcPercentDiff(
                    this.currentPrice,
                    price,
                ) > this.PRICE_DIFF
            )
        );
    }

    needCloseBuy() {
        const hasOpenedPosition = this.tradeSystem.hasBacktestOpenPositions();
        const isOpenedBuy = hasOpenedPosition && this.tradeSystem.getLastOpenedPosition()?.direction === 1;

        return isOpenedBuy &&
            (
                this.currentPrice >= this.priceToClosePosition ||
                this.MA < this.priceToClosePosition
            );
    }

    needCloseSell() {
        const hasOpenedPosition = this.tradeSystem.hasBacktestOpenPositions();
        const isOpenedSell = hasOpenedPosition && this.tradeSystem.getLastOpenedPosition()?.direction === 2;

        return isOpenedSell &&
            (
                this.currentPrice <= this.priceToClosePosition ||
                this.MA > this.priceToClosePosition
            );
    }

    hasTimeDiff(minutes: number) {
        try {
            const lastOpenedPositionTime = this.tradeSystem?.getLastOpenedPosition()?.time?.getTime();

            if (!lastOpenedPositionTime) {
                return false;
            }

            return this.currentCandle?.time &&
                this.currentCandle?.time?.getTime() - lastOpenedPositionTime > minutes * 60 * 1000;
        } catch (e) {
            return false;
        }
    }

    calcPercentDiff(partial: number, total: number) {
        return (partial * 100) / total - 100;
    }

    printResult() {
        let result = 0;

        this.tradeSystem.getBacktestPositions()?.forEach(position => {
            const price = Common.getPrice(position.price);

            if (typeof price === 'undefined') {
                return;
            }

            if (position.direction === 1) {
                result -= price * position.lots;
            } else if (position.direction === 2) {
                result += price * position.lots;
            }
        });

        const resultStr = result.toFixed(2);

        this.logSystem.append(resultStr);

        return resultStr;
    }

    consolePositionMessage(position: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const positionType = position.direction === 1 ? 'Покупка' : 'Продажа';
        const date = this.currentCandle?.time;
        const rsiStr = this.RSI ? `RSI: ${this.RSI}` : '';
        const priceToCloseStr = this.priceToClosePosition ? `Цена закрытия: ${this.priceToClosePosition}` : '';

        this.logSystem.appendArray([
            positionType,
            `Цена: ${position.price}`,
            `Дата: ${date}`,
            rsiStr,
            priceToCloseStr,
            ' ',
        ]);
    }

    calcLots(price: number, moneyLimit: number) {
        return Math.ceil(moneyLimit / price);
    }
}
