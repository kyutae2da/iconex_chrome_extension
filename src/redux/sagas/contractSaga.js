import { fork, put, takeLatest, call, select, all } from 'redux-saga/effects'
import { delay } from 'redux-saga'
import AT from 'redux/actionTypes/actionTypes';
import {
  icx_getScoreApi as GET_SCORE,
  icx_call as ICX_CALL,
  icx_sendTransaction as ICX_SEND_TRANSACTION
} from 'redux/api/walletIcxApi'
import { validateInputError } from 'redux/reducers/contractReducer'
import { validateCoinQuantityError, validateContractTxFeeLimitError } from 'redux/reducers/exchangeTransactionReducer'
import { openPopup } from 'redux/actions/popupActions'
import { executeFunc, setFuncInputError } from 'redux/actions/contractActions'
import { setWalletSelectorError, setCoinQuantityError, setContractTxFeeLimitError } from 'redux/actions/exchangeTransactionActions'
import { makeIcxRawTx, signRawTx } from 'utils'

export function* executeFuncFunc(action) {
  let payload, funcInputHex;
  const selectedAccount = yield select(state => state.wallet.selectedWallet.account);
  const contractAddress = yield select(state => state.contract.contractAddress);
  const funcList = yield select(state => state.contract.funcList);
  const funcInput = yield select(state => state.contract.funcInput);
  const selectedFuncIndex = yield select(state => state.contract.selectedFuncIndex);
  const func = funcList[selectedFuncIndex]

  try {
    if (func.inputs.length > 0) {
      /* delete null value & convert int to hex */
      funcInputHex = func.inputs.reduce((acc, cur) => {
        if (cur.hasOwnProperty('default') && !funcInput[cur.name]) {
          return acc
        }
        if (cur.type === 'int') {
          acc[cur.name] = window.web3.toHex(funcInput[cur.name])
        } else {
          acc[cur.name] = funcInput[cur.name]
        }
        return acc
      }, {});
    }

    if (func.readonly) {
      payload = yield call(ICX_CALL, {
        contractAddress,
        methodName: func['name'],
        inputObj: funcInputHex
      });
    } else {
      const payableValue = yield select(state => state.exchangeTransaction.coinQuantity);
      const privKey = yield select(state => state.exchangeTransaction.privKey);
      const txFeeLimit = yield select(state => state.exchangeTransaction.txFeeLimit);
      const rawTx = makeIcxRawTx(true, {
        from: selectedAccount,
        txFeeLimit: txFeeLimit,
        contractAddress,
        methodName: func['name'],
        inputObj: funcInputHex,
        payableValue: payableValue
      });
      const rawTxSigned = signRawTx(privKey, rawTx)
      payload = yield call(ICX_SEND_TRANSACTION, rawTxSigned);
    }
    yield put({type: AT.executeFuncFulfilled, payload: [payload]});
  } catch (error) {
    console.log(error)
    yield put({type: AT.executeFuncRejected, error});
  }
}

export function* checkContractInputErrorFunc(action) {
  let isLoggedIn, txFeeLimit, calcData, coinQuantity;
  const funcList = yield select(state => state.contract.funcList);
  const selectedFuncIndex = yield select(state => state.contract.selectedFuncIndex);
  const func = funcList[selectedFuncIndex]
  const isPayableFunc = func.hasOwnProperty('payable')

  try {
    let errorFlag = false;
    /* Input Error Handling */
    if (func.inputs.length > 0) {
      const errorArr = yield all(func.inputs.map(input => {
        const inputObj = {
          name: input.name,
          type: input.type,
          optional: input.hasOwnProperty('default') ? true : false
        }
        const error = validateInputError(inputObj)
        if (error) errorFlag = true;
        return {
          ...inputObj,
          error: error
        }
      }));
      yield all(errorArr.map((errorObj) =>
        put(setFuncInputError(errorObj))
      ))
    }

    if (!func.readonly) {
      isLoggedIn = yield select(state => state.exchangeTransaction.isLoggedIn);
      txFeeLimit = yield select(state => state.exchangeTransaction.txFeeLimit);
      coinQuantity = yield select(state => state.exchangeTransaction.coinQuantity);
      calcData = yield select(state => state.exchangeTransaction.calcData);
      if (!isLoggedIn) {
        yield put(setWalletSelectorError());
        errorFlag = true;
      } else if (isPayableFunc && validateCoinQuantityError({coinQuantity, calcData})) {
        yield put(setCoinQuantityError());
        errorFlag = true;
      } else if (validateContractTxFeeLimitError({txFeeLimit, calcData})) {
        yield put(setContractTxFeeLimitError());
        errorFlag = true;
      }
    }

    if (errorFlag) throw new Error('errorExist');

    if (func.readonly) {
      yield put(executeFunc())
    } else {
      yield put(openPopup({
        popupType: 'sendTransaction_contract',
        popupNum: 2
      }))
    }
  } catch (error) {
    console.log(error)
    yield put({type: AT.executeFuncRejected, error});
  }
}

export function* handleFuncInputChangeFunc(action) {
  try {
    const isLoggedIn = yield select(state => state.exchangeTransaction.isLoggedIn);
    if (isLoggedIn) {
      yield put({type: AT.getTxFeeInfo});
    }
  } catch (e) {
    alert(e);
  }
}

export function* fetchAbiFunc(action) {
  try {
    const payloadArr = yield call(GET_SCORE, action.payload);
    const payload = JSON.stringify(payloadArr);
    yield put({type: AT.fetchAbiFulfilled, payload});
  } catch (error) {
    yield put({type: AT.fetchAbiRejected, error});
  }
}

function* watchCheckContractInputError() {
  yield takeLatest(AT.checkContractInputError, checkContractInputErrorFunc)
}

function* watchExecuteFunc() {
  yield takeLatest(AT.executeFunc, executeFuncFunc)
}

function* watchFetchAbi() {
  yield takeLatest(AT.fetchAbi, fetchAbiFunc)
}

function* watchHandleFuncInputChange() {
  yield takeLatest(AT.handleFuncInputChange, handleFuncInputChangeFunc)
}

export default function* contractSaga() {
 yield fork(watchHandleFuncInputChange)
 yield fork(watchFetchAbi);
 yield fork(watchExecuteFunc);
 yield fork(watchCheckContractInputError);
}
